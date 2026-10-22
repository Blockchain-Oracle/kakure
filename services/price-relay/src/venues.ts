import { CRYPTO_STREAM_SYMBOLS, type Quote, type StreamSymbol, type UpstreamFeed } from "@kakure/feeds/protocol";
import { COINBASE_HEARTBEAT_PRODUCT, LANE_STREAM_SYMBOLS } from "./constants";

/** The two exchange sockets (Pyth is a keyed HTTP stream, in `pyth.ts`). */
export type SocketFeed = Exclude<UpstreamFeed, "pyth">;

const SYMBOLS = new Set<string>(CRYPTO_STREAM_SYMBOLS);

const LANE = new Set<string>(LANE_STREAM_SYMBOLS);

/** The subscribe messages a feed sends on connect (Coinbase takes one channel per message). */
export function subscribeMessages(source: SocketFeed): unknown[] {
  if (source === "coinbase") {
    const rest = CRYPTO_STREAM_SYMBOLS.filter((symbol) => !LANE.has(symbol));
    return [
      { type: "subscribe", channel: "ticker", product_ids: LANE_STREAM_SYMBOLS },
      { type: "subscribe", channel: "ticker_batch", product_ids: rest },
      { type: "subscribe", channel: "heartbeats", product_ids: [COINBASE_HEARTBEAT_PRODUCT] },
    ];
  }
  const symbols = CRYPTO_STREAM_SYMBOLS.map((symbol) => symbol.replace("-", "/"));
  return [{ method: "subscribe", params: { channel: "ticker", symbol: symbols } }];
}

/** Heartbeats and ticker messages are routine; anything else (errors, subscription replies) is worth a note. */
export function isRoutine(source: SocketFeed, text: string): boolean {
  return source === "coinbase"
    ? COINBASE_ROUTINE.some((channel) => text.startsWith(`{"channel":"${channel}"`))
    : text.includes('"channel":"heartbeat"') ||
        text.includes('"channel":"ticker"') ||
        text.includes('"channel":"status"');
}

const COINBASE_ROUTINE = ["heartbeats", "ticker", "ticker_batch"] as const;

interface CoinbaseMessage {
  channel?: string;
  timestamp?: string;
  events?: Array<{ tickers?: Array<{ product_id?: string; price?: string }> }>;
}

/** Coinbase `ticker` / `ticker_batch`: `{ channel, timestamp, events: [{ tickers: [{ product_id, price }] }] }`. */
export function parseCoinbase(data: string): Array<[StreamSymbol, Quote]> {
  const message = JSON.parse(data) as CoinbaseMessage;
  if ((message.channel !== "ticker" && message.channel !== "ticker_batch") || !Array.isArray(message.events)) {
    return [];
  }
  const ts = (message.timestamp && Date.parse(message.timestamp)) || Date.now();
  return message.events.flatMap((event) =>
    (event.tickers ?? []).flatMap(({ product_id: product, price }) =>
      product && price && SYMBOLS.has(product)
        ? [[product as StreamSymbol, { p: price, ts, src: "coinbase" }] as [StreamSymbol, Quote]]
        : [],
    ),
  );
}

/** Kraken v2 `ticker` messages: `{ channel: "ticker", data: [{ symbol: "BTC/USD", last }] }`. */
export function parseKraken(data: string): Array<[StreamSymbol, Quote]> {
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
