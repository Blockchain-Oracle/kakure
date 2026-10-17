import { DurableObject } from "cloudflare:workers";
import { CRYPTO_STREAM_SYMBOLS, type Quote, type RelayMessage, type StreamSymbol } from "@kakure/feeds/protocol";
import {
  BROADCAST_INTERVAL_MS,
  COINBASE_FAILURES_BEFORE_FALLBACK,
  COINBASE_WS,
  HTTP_SWITCHING_PROTOCOLS,
  IDLE_UPSTREAM_GRACE_MS,
  KRAKEN_WS,
  RECONNECT_BACKOFF_FACTOR,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  WS_CLOSE_GOING_AWAY,
} from "./constants";
import { SessionCalendar, streamStocks } from "./pyth";

type Upstream = "coinbase" | "kraken";

export interface HubEnv {
  /** Pyth Hermes key (Worker secret). Without it, stocks stay in their honest "connecting" state. */
  PYTH_API_KEY?: string;
}

/**
 * One Durable Object fans a single upstream exchange feed out to every client.
 * It keeps no logs and stores nothing about clients; the upstream only runs while someone is connected.
 */
export class PriceHub extends DurableObject<HubEnv> {
  private readonly prices = new Map<StreamSymbol, Quote>();
  private readonly pending = new Map<StreamSymbol, Quote>();
  private upstream: WebSocket | null = null;
  private source: Upstream = "coinbase";
  private coinbaseFailures = 0;
  private backoffMs = RECONNECT_MIN_MS;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stocks: AbortController | null = null;
  private stockBackoffMs = RECONNECT_MIN_MS;
  private sessions: SessionCalendar | null = null;

  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith("/snapshot")) {
      return Response.json({ t: "snap", prices: Object.fromEntries(this.prices) } satisfies RelayMessage);
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ t: "snap", prices: Object.fromEntries(this.prices) } satisfies RelayMessage));
    await this.ctx.storage.deleteAlarm();
    this.ensureUpstream();
    return new Response(null, { status: HTTP_SWITCHING_PROTOCOLS, webSocket: client });
  }

  /** Clients only listen; anything they send is ignored. */
  override webSocketMessage(): void {}

  override async webSocketClose(socket: WebSocket): Promise<void> {
    socket.close(WS_CLOSE_GOING_AWAY, "bye");
    if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_UPSTREAM_GRACE_MS);
    }
  }

  /** Fires after the idle grace: close the upstream if nobody came back. */
  override alarm(): void {
    if (this.ctx.getWebSockets().length === 0) {
      this.upstream?.close(WS_CLOSE_GOING_AWAY, "idle");
      this.upstream = null;
      this.stocks?.abort();
      this.stocks = null;
    }
  }

  private ensureUpstream(): void {
    this.ensureStocks();
    if (this.upstream) {
      return;
    }
    this.openUpstream().catch(() => this.scheduleReconnect());
  }

  /** Keyed Pyth stream for stocks, server-side only (the key never reaches clients). */
  private ensureStocks(): void {
    const key = this.env.PYTH_API_KEY;
    if (!key || this.stocks) {
      return;
    }
    const controller = new AbortController();
    this.stocks = controller;
    const run = async () => {
      this.sessions ??= await SessionCalendar.load();
      await streamStocks(key, this.sessions, (quotes) => this.accept(quotes), controller.signal);
    };
    run()
      .catch(() => undefined)
      .finally(() => {
        if (this.stocks !== controller) {
          return;
        }
        this.stocks = null;
        if (!controller.signal.aborted && this.ctx.getWebSockets().length > 0) {
          const delay = this.stockBackoffMs;
          this.stockBackoffMs = Math.min(this.stockBackoffMs * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_MS);
          setTimeout(() => this.ensureStocks(), delay);
        }
      });
  }

  private async openUpstream(): Promise<void> {
    const url = this.source === "coinbase" ? COINBASE_WS : KRAKEN_WS;
    const response = await fetch(url, { headers: { Upgrade: "websocket" } });
    const socket = response.webSocket;
    if (!socket) {
      throw new Error(`${this.source} refused the WebSocket upgrade (${response.status})`);
    }
    socket.accept();
    this.upstream = socket;
    socket.send(JSON.stringify(this.subscribeMessage()));
    socket.addEventListener("message", (event) => this.onUpstreamMessage(event.data));
    socket.addEventListener("close", () => this.onUpstreamLost());
    socket.addEventListener("error", () => this.onUpstreamLost());
    this.backoffMs = RECONNECT_MIN_MS;
    this.broadcast({ t: "status", upstream: "connected" });
  }

  private subscribeMessage(): unknown {
    if (this.source === "coinbase") {
      return { type: "subscribe", product_ids: CRYPTO_STREAM_SYMBOLS, channels: ["ticker_batch"] };
    }
    const symbols = CRYPTO_STREAM_SYMBOLS.map((symbol) => symbol.replace("-", "/"));
    return { method: "subscribe", params: { channel: "ticker", symbol: symbols } };
  }

  private onUpstreamMessage(data: string | ArrayBuffer): void {
    if (typeof data !== "string") {
      return;
    }
    const quotes = this.source === "coinbase" ? parseCoinbase(data) : parseKraken(data);
    if (quotes.length > 0 && this.source === "coinbase") {
      this.coinbaseFailures = 0;
    }
    this.accept(quotes);
  }

  private accept(quotes: Array<[StreamSymbol, Quote]>): void {
    if (quotes.length === 0) {
      return;
    }
    this.stockBackoffMs = RECONNECT_MIN_MS;
    for (const [symbol, quote] of quotes) {
      this.prices.set(symbol, quote);
      this.pending.set(symbol, quote);
    }
    this.flushTimer ??= setTimeout(() => this.flush(), BROADCAST_INTERVAL_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.pending.size === 0) {
      return;
    }
    this.broadcast({ t: "ticks", prices: Object.fromEntries(this.pending) });
    this.pending.clear();
  }

  private onUpstreamLost(): void {
    if (!this.upstream) {
      return;
    }
    this.upstream = null;
    if (this.source === "coinbase") {
      this.coinbaseFailures += 1;
      if (this.coinbaseFailures >= COINBASE_FAILURES_BEFORE_FALLBACK) {
        this.source = "kraken";
      }
    }
    this.broadcast({ t: "status", upstream: "reconnecting" });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.ctx.getWebSockets().length === 0) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_MS);
    setTimeout(() => this.ensureUpstream(), delay);
  }

  private broadcast(message: RelayMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // A socket closing mid-send is cleaned up by webSocketClose.
      }
    }
  }
}

const SYMBOLS = new Set<string>(CRYPTO_STREAM_SYMBOLS);

/** Coinbase `ticker` / `ticker_batch` messages: `{ type: "ticker", product_id, price, time }`. */
function parseCoinbase(data: string): Array<[StreamSymbol, Quote]> {
  const message = JSON.parse(data) as { type?: string; product_id?: string; price?: string; time?: string };
  if (message.type !== "ticker" || !message.product_id || !message.price || !SYMBOLS.has(message.product_id)) {
    return [];
  }
  const ts = message.time ? Date.parse(message.time) : Date.now();
  return [[message.product_id as StreamSymbol, { p: message.price, ts, src: "coinbase" }]];
}

/** Kraken v2 `ticker` messages: `{ channel: "ticker", data: [{ symbol: "BTC/USD", last }] }`. */
function parseKraken(data: string): Array<[StreamSymbol, Quote]> {
  const message = JSON.parse(data) as { channel?: string; data?: Array<{ symbol?: string; last?: number | string }> };
  if (message.channel !== "ticker" || !Array.isArray(message.data)) {
    return [];
  }
  const now = Date.now();
  return message.data.flatMap((entry) => {
    const symbol = entry.symbol?.replace("/", "-");
    if (!symbol || entry.last === undefined || !SYMBOLS.has(symbol)) {
      return [];
    }
    return [[symbol as StreamSymbol, { p: String(entry.last), ts: now, src: "kraken" }]];
  });
}
