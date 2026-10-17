/**
 * The price stream between the relay (services/price-relay) and every client.
 * Privacy (PD19): every client receives every symbol, so the relay never learns which markets someone watches.
 * Clients never connect to exchanges directly, so KYC venues never see a visitor's IP next to Kakure.
 */

/** The 22 assets listed against USD on all five venues (research §5); all online on Coinbase as `-USD`. */
export const CRYPTO_SYMBOLS = [
  "AAVE",
  "ARB",
  "AVAX",
  "BCH",
  "BTC",
  "CRV",
  "DOGE",
  "DOT",
  "ETH",
  "HYPE",
  "LINK",
  "LTC",
  "OP",
  "PEPE",
  "POL",
  "SHIB",
  "SKY",
  "SOL",
  "SUI",
  "UNI",
  "XRP",
  "ZEC",
] as const;
export type CryptoSymbol = (typeof CRYPTO_SYMBOLS)[number];

/** Stream keys are `<ASSET>-USD`, the Coinbase product id. */
export type StreamSymbol = `${CryptoSymbol}-USD`;
export const STREAM_SYMBOLS: readonly StreamSymbol[] = CRYPTO_SYMBOLS.map((symbol) => `${symbol}-USD` as const);

export const STREAM_PATH = "/v1/stream";
export const SNAPSHOT_PATH = "/v1/snapshot";

/** A price as the venue reported it (decimal string, never a float) and the venue's timestamp (ms). */
export interface Quote {
  p: string;
  ts: number;
  /** Which upstream produced it. */
  src: "coinbase" | "kraken";
}

/** Sent once on connect: every known price. */
export interface SnapshotMessage {
  t: "snap";
  prices: Partial<Record<StreamSymbol, Quote>>;
}

/** Sent as prices change, batched by the relay. */
export interface TicksMessage {
  t: "ticks";
  prices: Partial<Record<StreamSymbol, Quote>>;
}

/** Upstream health, so clients can show an honest "stale" state. */
export interface StatusMessage {
  t: "status";
  upstream: "connected" | "reconnecting";
}

export type RelayMessage = SnapshotMessage | TicksMessage | StatusMessage;

/** A price with no update for this long is shown as stale (with its age). */
export const STALE_AFTER_MS = 30_000;
