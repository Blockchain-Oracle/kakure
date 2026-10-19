import {
  BARS_PATH,
  type BarsResponse,
  type Quote,
  type RelayMessage,
  STALE_AFTER_MS,
  STREAM_PATH,
  type StreamSymbol,
} from "./protocol";

/**
 * Every symbol's history in one response (PD19: the relay never learns which one you look at). Cached by the
 * browser for the relay's max-age; a failure resolves to empty bars so charts start from live ticks.
 */
export async function fetchBars(relayOrigin: string): Promise<BarsResponse> {
  try {
    const response = await fetch(`${relayOrigin}${BARS_PATH}`);
    if (!response.ok) return { fiveMinute: {}, oneMinute: {} };
    return (await response.json()) as BarsResponse;
  } catch {
    return { fiveMinute: {}, oneMinute: {} };
  }
}

export type PriceStatus = "connecting" | "live" | "stale" | "closed";

export interface PriceState {
  status: PriceStatus;
  price?: string;
  ts?: number;
  /** Which upstream the relay took this price from (Coinbase, or Kraken while Coinbase is silent on it; Pyth). */
  src?: Quote["src"];
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_BACKOFF_FACTOR = 2;
const CONNECTING: PriceState = { status: "connecting" };

/**
 * One relay connection per tab or app (Owarine/Mitoshi pattern). Prices live outside React and
 * subscribers are notified per symbol, so a chart can redraw every frame without re-rendering the tree.
 * The socket closes while the page is hidden and reopens when it's visible again.
 */
export class PriceStream {
  private socket: WebSocket | null = null;
  private readonly quotes = new Map<StreamSymbol, Quote>();
  private readonly states = new Map<StreamSymbol, PriceState>();
  private readonly listeners = new Map<StreamSymbol, Set<() => void>>();
  private upstreamHealthy = false;
  private backoffMs = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly relayOrigin: string) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  /** Current state for a symbol, with stale detection based on the venue timestamp. */
  get(symbol: StreamSymbol, now = Date.now()): PriceState {
    const quote = this.quotes.get(symbol);
    if (!quote) {
      return CONNECTING;
    }
    const status: PriceStatus = this.upstreamHealthy && now - quote.ts < STALE_AFTER_MS ? "live" : "stale";
    const cached = this.states.get(symbol);
    if (
      cached &&
      cached.status === status &&
      cached.price === quote.p &&
      cached.ts === quote.ts &&
      cached.src === quote.src
    ) {
      return cached; // stable identity for useSyncExternalStore
    }
    const next: PriceState = { status, price: quote.p, ts: quote.ts, src: quote.src };
    this.states.set(symbol, next);
    return next;
  }

  subscribe(symbol: StreamSymbol, listener: () => void): () => void {
    let set = this.listeners.get(symbol);
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  private open(): void {
    const url = `${this.relayOrigin.replace(/^http/, "ws")}${STREAM_PATH}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onmessage = (event) => this.onMessage(String(event.data));
    socket.onopen = () => {
      this.backoffMs = RECONNECT_MIN_MS;
    };
    socket.onclose = () => {
      this.upstreamHealthy = false;
      this.notifyAll();
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.open(), this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_MS);
      }
    };
  }

  private onMessage(raw: string): void {
    const message = JSON.parse(raw) as RelayMessage;
    if (message.t === "status") {
      this.upstreamHealthy = message.upstream === "connected";
      this.notifyAll();
      return;
    }
    this.upstreamHealthy = true;
    for (const [symbol, quote] of Object.entries(message.prices) as Array<[StreamSymbol, Quote]>) {
      this.quotes.set(symbol, quote);
      for (const listener of this.listeners.get(symbol) ?? []) {
        listener();
      }
    }
  }

  private notifyAll(): void {
    for (const set of this.listeners.values()) {
      for (const listener of set) {
        listener();
      }
    }
  }
}
