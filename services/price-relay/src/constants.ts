import { LANE_ASSETS } from "@kakure/domain";
import type { StreamSymbol } from "@kakure/feeds/protocol";
/**
 * Coinbase Exchange public feed. The traded assets (every lane asset) take `ticker`: one message per trade, as Owarine's
 * ops (`prices/crypto-spot.ts`), so the chart and the house's quotes move with the market. The rest (sparklines only)
 * take `ticker_batch`: each product's latest price every 5 s.
 */
export const COINBASE_WS = "https://ws-feed.exchange.coinbase.com";
/** Coinbase Exchange public REST, for history backfill (candles). */
export const COINBASE_REST = "https://api.exchange.coinbase.com";
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
export const CANDLE_CLOSE = 4;
export const MS_PER_SECOND = 1_000;

/** Reconnect backoff for the upstream socket. */
export const RECONNECT_MIN_MS = 1_000;
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
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const WS_CLOSE_GOING_AWAY = 1001;
