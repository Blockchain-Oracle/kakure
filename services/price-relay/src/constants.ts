/** Coinbase Exchange public feed; `ticker_batch` sends each product's latest price every 5 s (fits the free plan). */
export const COINBASE_WS = "https://ws-feed.exchange.coinbase.com";
/** Kraken WS v2: fallback when Coinbase keeps failing. Symbols use `BTC/USD` naming. */
export const KRAKEN_WS = "https://ws.kraken.com/v2";

/** Coinbase failures in a row before switching to Kraken. */
export const COINBASE_FAILURES_BEFORE_FALLBACK = 3;

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

/** One hub for everyone: every client gets every symbol (PD19). */
export const HUB_NAME = "global";

export const HTTP_SWITCHING_PROTOCOLS = 101;
export const HTTP_UPGRADE_REQUIRED = 426;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const WS_CLOSE_GOING_AWAY = 1001;
