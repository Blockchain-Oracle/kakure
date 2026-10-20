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

/** US stocks and ETFs, priced by Pyth (keyed, server-side only) during the NYSE regular session. */
export const STOCK_SYMBOLS = ["AAPL", "TSLA", "NVDA", "SPY", "QQQ", "MSFT", "META", "AMZN", "GOOGL", "VOO"] as const;
export type StockSymbol = (typeof STOCK_SYMBOLS)[number];

/** Pyth price feed ids (Equity.US.<SYMBOL>/USD), from Hermes /v2/price_feeds on 2026-10-17. */
export const PYTH_FEED_IDS: Readonly<Record<StockSymbol, string>> = {
  AAPL: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  NVDA: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  SPY: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
  QQQ: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
  MSFT: "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
  META: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe",
  AMZN: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
  GOOGL: "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6",
  VOO: "236b30dd09a9c00dfeec156c7b1efd646c0f01825a1758e3e4a0679e3bdff179",
};

/** Stream keys are `<ASSET>-USD` (the Coinbase product id for crypto). */
export type StreamSymbol = `${CryptoSymbol | StockSymbol}-USD`;
export const CRYPTO_STREAM_SYMBOLS: readonly StreamSymbol[] = CRYPTO_SYMBOLS.map((symbol) => `${symbol}-USD` as const);
export const STOCK_STREAM_SYMBOLS: readonly StreamSymbol[] = STOCK_SYMBOLS.map((symbol) => `${symbol}-USD` as const);
export const STREAM_SYMBOLS: readonly StreamSymbol[] = [...CRYPTO_STREAM_SYMBOLS, ...STOCK_STREAM_SYMBOLS];

export const STREAM_PATH = "/v1/stream";
export const SNAPSHOT_PATH = "/v1/snapshot";
/** Upstream health: each feed's state and every symbol's last-tick age. Public and the same for everyone. */
export const HEALTH_PATH = "/v1/health";
/** Price history for every symbol in one response, so the relay never learns which one a visitor looks at (PD19). */
export const BARS_PATH = "/v1/bars";
/**
 * OHLC candles at one interval for every traded asset in one response (PD19), for the terminal's candle view
 * (Owarine's intervals). `?interval=1h&count=300`, and `&end=<unix ms>` for older history.
 */
export const CANDLES_PATH = "/v1/candles";
export const CANDLE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "12h", "1d"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];
export const CANDLE_INTERVAL_MS: Readonly<Record<CandleInterval, number>> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
};
/** At most this many candles per symbol per response. */
export const CANDLES_MAX = 300;

/** A price as the venue reported it (decimal string, never a float) and the venue's timestamp (ms). */
export interface Quote {
  p: string;
  ts: number;
  /** Which upstream produced it. */
  src: "coinbase" | "kraken" | "pyth";
  /** Stocks only: whether the NYSE regular session is open now (from Pyth's published schedule). */
  open?: boolean;
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

/** A closing price at a bar's start time: `[unix ms, decimal price]`. */
export type BarPoint = [number, string];

/** One candle: `[start (unix ms), open, high, low, close]`, prices as decimal strings. */
export type CandleRow = [number, string, string, string, string];

/** `CANDLES_PATH`: closed candles (and the one forming) per symbol, oldest first. */
export interface CandlesResponse {
  interval: CandleInterval;
  candles: Partial<Record<StreamSymbol, CandleRow[]>>;
}

/** `BARS_PATH`: 5-minute closes over the last day (sparklines) and 1-minute closes (charts), oldest first. */
export interface BarsResponse {
  fiveMinute: Partial<Record<StreamSymbol, BarPoint[]>>;
  oneMinute: Partial<Record<StreamSymbol, BarPoint[]>>;
}

export type UpstreamFeed = "coinbase" | "kraken" | "pyth";

/** `HEALTH_PATH`: per-feed state and per-symbol freshness. Nothing about clients. */
export interface HealthResponse {
  feeds: Record<UpstreamFeed, { connected: boolean; since: number | null; messages: number }>;
  symbols: Partial<Record<StreamSymbol, { src: Quote["src"]; ageMs: number }>>;
  /** The last few upstream messages that were neither ticks nor heartbeats (errors, subscription replies). */
  notes: string[];
}

/** A price with no update for this long is shown as stale (with its age). */
export const STALE_AFTER_MS = 30_000;
