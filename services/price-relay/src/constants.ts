import { LANE_ASSETS } from "@kakure/domain";
import type { StreamSymbol } from "@kakure/feeds/protocol";
/**
 * Coinbase's public market-data socket (Advanced Trade; no key). The traded assets (every lane asset) take `ticker`: an
 * update on every match, as Owarine's ops (`prices/crypto-spot.ts`), so the chart and the house's quotes move with the
 * market. The rest (sparklines only) take `ticker_batch`: each product's latest price every 5 s. `heartbeats` keeps
 * quiet channels open. The Exchange feed (`ws-feed.exchange.coinbase.com`) caps `ticker` subscribers per product per
 * address and refuses busy products from a Worker's shared egress, so it isn't used.
 */
export const COINBASE_WS = "https://advanced-trade-ws.coinbase.com";
/** Coinbase's `heartbeats` channel takes a product list; one product keeps the whole socket open. */
export const COINBASE_HEARTBEAT_PRODUCT = "BTC-USD";
/** Coinbase Exchange public REST, for history backfill (candles). */
export const COINBASE_REST = "https://api.exchange.coinbase.com";
/** Coinbase's REST refuses a request without a User-Agent; this one names the relay, nothing about any visitor. */
export const COINBASE_REST_HEADERS = { accept: "application/json", "user-agent": "kakure-price-relay/1" } as const;
/** Kraken WS v2, connected alongside Coinbase. Symbols use `BTC/USD` naming. */
export const KRAKEN_WS = "https://ws.kraken.com/v2";

/**
 * Per-symbol fallback: a symbol with no Coinbase tick for this long takes Kraken's price until Coinbase speaks again.
 * `ticker_batch` repeats every product every 5 s, so two missed batches mean that symbol is silent; a traded asset on
 * `ticker` that hasn't traded for this long is quiet enough that Kraken's last trade is as current.
 */
export const SILENT_AFTER_MS = 12_000;

/** Bars: 5-minute closes for a day (sparklines) and 1-minute closes for five hours (window charts). */
export const FIVE_MINUTE_MS = 300_000;
export const ONE_MINUTE_MS = 60_000;
export const FIVE_MINUTE_BARS_KEPT = 288;
export const ONE_MINUTE_BARS_KEPT = 300;
/** Coinbase candle granularities (seconds) matching the two bar sizes; one request returns up to 300 candles. */
export const FIVE_MINUTE_GRANULARITY_S = 300;
export const ONE_MINUTE_GRANULARITY_S = 60;
/** The traded assets' streams: every lane asset (the markets' list in @kakure/domain, never a copy of it). */
export const LANE_STREAM_SYMBOLS: readonly StreamSymbol[] = LANE_ASSETS.map((asset) => `${asset}-USD` as const);
/** 1-minute history is backfilled for every traded asset; the rest fill from live ticks. */
export const MINUTE_BACKFILL_SYMBOLS = LANE_STREAM_SYMBOLS;
/** Parallel candle requests during a backfill (Coinbase's public limit is about 10 per second). */
export const BACKFILL_CONCURRENCY = 4;
/** The bars response may be cached this long by browsers and the edge. */
export const BARS_CACHE_SECONDS = 30;

/** How many unusual upstream messages `/v1/health` keeps, and how much of each. */
export const NOTES_KEPT = 8;
export const NOTE_CHARS = 240;

/** Candle tuple positions in Coinbase's `[time, low, high, open, close, volume]`. */
export const CANDLE_TIME = 0;
export const CANDLE_LOW = 1;
export const CANDLE_HIGH = 2;
export const CANDLE_OPEN = 3;
export const CANDLE_CLOSE = 4;

/**
 * The terminal's candle intervals from Coinbase's granularities (60, 300, 900, 3600, 21600, 86400 s): `[granularity,
 * how many make one candle]`. 3m, 30m, 2h, 4h and 12h are aggregated; buckets align to UTC like Coinbase's own.
 */
export const CANDLE_BASE = {
  "1m": [60, 1],
  "3m": [60, 3],
  "5m": [300, 1],
  "15m": [900, 1],
  "30m": [900, 2],
  "1h": [3_600, 1],
  "2h": [3_600, 2],
  "4h": [3_600, 4],
  "12h": [21_600, 2],
  "1d": [86_400, 1],
} as const;
/** Coinbase serves at most this many candles a request. */
export const COINBASE_CANDLES_PER_REQUEST = 300;
/** The newest candles are shared by every visitor for this long (the forming one follows live ticks on the client). */
export const CANDLES_LIVE_TTL_MS = 10_000;
/** Older history (with `end`) never changes; this many responses are kept. */
export const CANDLES_OLDER_KEPT = 40;
/** Older history may be cached by browsers this long; the newest only briefly. */
export const CANDLES_OLDER_CACHE_SECONDS = 86_400;
export const CANDLES_LIVE_CACHE_SECONDS = 10;
export const MS_PER_SECOND = 1_000;

/** Reconnect backoff for the upstream socket. */
export const RECONNECT_MIN_MS = 1_000;
/**
 * A feed socket that delivers nothing for this long is dead even if it never closed (a dropped connection, a sleeping
 * host, an exchange stall): it's dropped and reopened. Kraken sends a heartbeat every second and Coinbase's ticker
 * moves many times a second, so a live feed is never this quiet.
 */
export const FEED_SILENT_MS = 15_000;
/** How often the watchdog listens for silent feeds while anyone is connected. */
export const FEED_WATCHDOG_MS = 5_000;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_BACKOFF_FACTOR = 2;

/** Ticks are merged and sent to clients at most this often. */
export const BROADCAST_INTERVAL_MS = 250;

/** The upstream closes this long after the last client leaves, so an idle relay costs nothing. */
export const IDLE_UPSTREAM_GRACE_MS = 30_000;

/** Browsers must come from these origins; native apps send no Origin header. */
export const ALLOWED_ORIGINS = [
  "https://getkakure.xyz",
  "https://www.getkakure.xyz",
  "https://docs.getkakure.xyz",
  // The data worker's own address (services/data-worker), live before and alongside the custom domain.
  "https://kakure-web.kakure-price-relay.workers.dev",
  "http://localhost:3000",
  "http://localhost:3001",
] as const;

/**
 * One hub for everyone: every client gets every symbol (PD19). The generation suffix is bumped when the hub must
 * restart on new code: on 2026-10-19 the "global" object was found still running an old build (its subscription
 * lacked BTC, ETH and SOL) because clients kept it busy across deploys. A new name starts a fresh object; the old one
 * dies once its last client leaves.
 */
export const HUB_NAME = "global-2";

export const HTTP_SWITCHING_PROTOCOLS = 101;
export const HTTP_UPGRADE_REQUIRED = 426;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const WS_CLOSE_GOING_AWAY = 1001;
