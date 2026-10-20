import { DurableObject } from "cloudflare:workers";
import {
  BARS_PATH,
  CRYPTO_STREAM_SYMBOLS,
  HEALTH_PATH,
  type HealthResponse,
  type Quote,
  type RelayMessage,
  type StreamSymbol,
  type UpstreamFeed,
} from "@kakure/feeds/protocol";
import { BarStore } from "./bars";
import {
  BARS_CACHE_SECONDS,
  BROADCAST_INTERVAL_MS,
  COINBASE_WS,
  HTTP_SWITCHING_PROTOCOLS,
  IDLE_UPSTREAM_GRACE_MS,
  KRAKEN_WS,
  LANE_STREAM_SYMBOLS,
  MINUTE_BACKFILL_SYMBOLS,
  NOTE_CHARS,
  NOTES_KEPT,
  RECONNECT_BACKOFF_FACTOR,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  SILENT_AFTER_MS,
  WS_CLOSE_GOING_AWAY,
} from "./constants";
import { SessionCalendar, streamStocks } from "./pyth";

type SocketFeed = Exclude<UpstreamFeed, "pyth">;

interface FeedState {
  socket: WebSocket | null;
  since: number | null;
  backoffMs: number;
  messages: number;
}

export interface HubEnv {
  /** Pyth Hermes key (Worker secret). Without it, stocks stay in their honest "connecting" state. */
  PYTH_API_KEY?: string;
}

/**
 * One Durable Object fans two upstream exchange feeds out to every client.
 * Coinbase is the primary; Kraken runs alongside it, and a symbol takes Kraken's price only while Coinbase has been
 * silent on that symbol for `SILENT_AFTER_MS`, so one dead symbol never goes dark. It keeps no logs and stores
 * nothing about clients; the upstreams only run while someone is connected.
 */
export class PriceHub extends DurableObject<HubEnv> {
  private readonly prices = new Map<StreamSymbol, Quote>();
  private readonly pending = new Map<StreamSymbol, Quote>();
  /** When each symbol last ticked on Coinbase (arrival time), for the per-symbol fallback. */
  private readonly coinbaseSeen = new Map<StreamSymbol, number>();
  private readonly feeds: Record<SocketFeed, FeedState> = {
    coinbase: { socket: null, since: null, backoffMs: RECONNECT_MIN_MS, messages: 0 },
    kraken: { socket: null, since: null, backoffMs: RECONNECT_MIN_MS, messages: 0 },
  };
  private readonly bars = new BarStore();
  private readonly notes: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stocks: AbortController | null = null;
  private stocksSince: number | null = null;
  private stockMessages = 0;
  private stockBackoffMs = RECONNECT_MIN_MS;
  private sessions: SessionCalendar | null = null;

  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH) {
      return Response.json(this.health(), { headers: { "cache-control": "no-store" } });
    }
    if (pathname === BARS_PATH) {
      this.ensureUpstream();
      await this.bars.ensureBackfill(CRYPTO_STREAM_SYMBOLS, MINUTE_BACKFILL_SYMBOLS);
      return Response.json(this.bars.snapshot(), {
        headers: { "cache-control": `public, max-age=${BARS_CACHE_SECONDS}` },
      });
    }
    if (pathname.endsWith("/snapshot")) {
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

  /** Fires after the idle grace: close the upstreams if nobody came back. */
  override alarm(): void {
    if (this.ctx.getWebSockets().length > 0) {
      return;
    }
    for (const feed of Object.values(this.feeds)) {
      feed.socket?.close(WS_CLOSE_GOING_AWAY, "idle");
      feed.socket = null;
      feed.since = null;
    }
    this.stocks?.abort();
    this.stocks = null;
    this.stocksSince = null;
  }

  private ensureUpstream(): void {
    this.ensureStocks();
    for (const source of Object.keys(this.feeds) as SocketFeed[]) {
      if (!this.feeds[source].socket) {
        this.openFeed(source).catch((error: unknown) => {
          this.note(`${source} connect failed: ${String(error)}`);
          this.scheduleReconnect(source);
        });
      }
    }
    void this.bars.ensureBackfill(CRYPTO_STREAM_SYMBOLS, MINUTE_BACKFILL_SYMBOLS);
  }

  /** Keyed Pyth stream for stocks, server-side only (the key never reaches clients). */
  private ensureStocks(): void {
    const key = this.env.PYTH_API_KEY;
    if (!key || this.stocks) {
      return;
    }
    const controller = new AbortController();
    this.stocks = controller;
    this.stocksSince = Date.now();
    const run = async () => {
      this.sessions ??= await SessionCalendar.load();
      await streamStocks(key, this.sessions, (quotes) => this.accept(quotes, "pyth"), controller.signal);
    };
    run()
      .catch((error: unknown) => this.note(`pyth stream ended: ${String(error)}`))
      .finally(() => {
        if (this.stocks !== controller) {
          return;
        }
        this.stocks = null;
        this.stocksSince = null;
        if (!controller.signal.aborted && this.ctx.getWebSockets().length > 0) {
          const delay = this.stockBackoffMs;
          this.stockBackoffMs = Math.min(this.stockBackoffMs * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_MS);
          setTimeout(() => this.ensureStocks(), delay);
        }
      });
  }

  private async openFeed(source: SocketFeed): Promise<void> {
    const feed = this.feeds[source];
    const response = await fetch(source === "coinbase" ? COINBASE_WS : KRAKEN_WS, {
      headers: { Upgrade: "websocket" },
    });
    const socket = response.webSocket;
    if (!socket) {
      throw new Error(`${source} refused the WebSocket upgrade (${response.status})`);
    }
    socket.accept();
    feed.socket = socket;
    feed.since = Date.now();
    socket.send(JSON.stringify(subscribeMessage(source)));
    socket.addEventListener("message", (event) => this.onFeedMessage(source, event.data));
    socket.addEventListener("close", (event) =>
      this.onFeedLost(source, socket, `closed ${event.code} ${event.reason}`),
    );
    socket.addEventListener("error", () => this.onFeedLost(source, socket, "socket error"));
    feed.backoffMs = RECONNECT_MIN_MS;
    if (source === "coinbase") {
      this.broadcast({ t: "status", upstream: "connected" });
    }
  }

  private onFeedMessage(source: SocketFeed, data: string | ArrayBuffer): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.feeds[source].messages += 1;
    let quotes: Array<[StreamSymbol, Quote]>;
    try {
      quotes = source === "coinbase" ? parseCoinbase(text) : parseKraken(text);
    } catch {
      this.note(`${source} unparsable: ${text}`);
      return;
    }
    if (quotes.length === 0 && !isRoutine(source, text)) {
      this.note(`${source}: ${text}`);
    }
    this.accept(quotes, source);
  }

  /** Coinbase always wins for a symbol it has ticked recently; Kraken fills only the silent ones. */
  private accept(quotes: Array<[StreamSymbol, Quote]>, source: UpstreamFeed): void {
    if (quotes.length === 0) {
      return;
    }
    const now = Date.now();
    if (source === "pyth") {
      this.stockBackoffMs = RECONNECT_MIN_MS;
      this.stockMessages += 1;
    }
    for (const [symbol, quote] of quotes) {
      if (source === "coinbase") {
        this.coinbaseSeen.set(symbol, now);
      } else if (source === "kraken" && now - (this.coinbaseSeen.get(symbol) ?? 0) < SILENT_AFTER_MS) {
        continue;
      }
      this.prices.set(symbol, quote);
      this.pending.set(symbol, quote);
      this.bars.record(symbol, quote.p, quote.ts);
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

  private onFeedLost(source: SocketFeed, socket: WebSocket, why: string): void {
    const feed = this.feeds[source];
    if (feed.socket !== socket) {
      return;
    }
    feed.socket = null;
    feed.since = null;
    this.note(`${source} lost: ${why}`);
    if (source === "coinbase") {
      this.broadcast({ t: "status", upstream: "reconnecting" });
    }
    this.scheduleReconnect(source);
  }

  private scheduleReconnect(source: SocketFeed): void {
    if (this.ctx.getWebSockets().length === 0) {
      return;
    }
    const feed = this.feeds[source];
    const delay = feed.backoffMs;
    feed.backoffMs = Math.min(feed.backoffMs * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_MS);
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

  private note(text: string): void {
    this.notes.push(`${new Date().toISOString()} ${text.slice(0, NOTE_CHARS)}`);
    if (this.notes.length > NOTES_KEPT) {
      this.notes.shift();
    }
  }

  private health(): HealthResponse {
    const now = Date.now();
    const feed = (state: FeedState) => ({
      connected: state.socket !== null,
      since: state.since,
      messages: state.messages,
    });
    return {
      feeds: {
        coinbase: feed(this.feeds.coinbase),
        kraken: feed(this.feeds.kraken),
        pyth: { connected: this.stocks !== null, since: this.stocksSince, messages: this.stockMessages },
      },
      symbols: Object.fromEntries(
        [...this.prices].map(([symbol, quote]) => [symbol, { src: quote.src, ageMs: now - quote.ts }]),
      ),
      notes: [...this.notes],
    };
  }
}

const SYMBOLS = new Set<string>(CRYPTO_STREAM_SYMBOLS);

const LANE = new Set<string>(LANE_STREAM_SYMBOLS);

function subscribeMessage(source: SocketFeed): unknown {
  if (source === "coinbase") {
    return {
      type: "subscribe",
      channels: [
        { name: "ticker", product_ids: LANE_STREAM_SYMBOLS },
        { name: "ticker_batch", product_ids: CRYPTO_STREAM_SYMBOLS.filter((symbol) => !LANE.has(symbol)) },
      ],
    };
  }
  const symbols = CRYPTO_STREAM_SYMBOLS.map((symbol) => symbol.replace("-", "/"));
  return { method: "subscribe", params: { channel: "ticker", symbol: symbols } };
}

/** Heartbeats and ticker snapshots are routine; anything else (errors, subscription replies) is worth a note. */
function isRoutine(source: SocketFeed, text: string): boolean {
  return source === "coinbase"
    ? text.includes('"type":"heartbeat"') || text.includes('"type":"ticker"')
    : text.includes('"channel":"heartbeat"') ||
        text.includes('"channel":"ticker"') ||
        text.includes('"channel":"status"');
}

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
