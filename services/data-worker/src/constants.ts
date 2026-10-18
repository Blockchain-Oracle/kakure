/** Public data lives under this path; store keys are the path after it, e.g. `testnet/latest.json`. */
export const DATA_PREFIX = "/data/";

/** `latest.json` is the only mutable file: short cache plus stale-while-revalidate (plan §2, §13.11). */
export const LATEST_FILE = "latest.json";
export const LATEST_CACHE = "public, max-age=20, stale-while-revalidate=40";

/** Every other published file is content-addressed or numbered, so it never changes. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Next's build output: every file name carries its content hash, so it is cached as immutable too. */
export const NEXT_STATIC_PREFIX = "/_next/static/";

/** Networks the operator publishes for. Anything else is rejected before touching the store. */
export const NETWORKS = ["mainnet", "testnet"] as const;

/** Keys are `<network>/<file>` with a conservative character set; no traversal, no nesting beyond one folder. */
export const KEY_PATTERN = /^(mainnet|testnet)\/[a-z0-9][a-z0-9._-]{0,127}\.json$/;

/** Headers on every response: no referrer, no sniffing, no framing, nothing cached by intermediaries we don't control. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

/** A pushed file larger than this is refused unread; a SQLite row holds at most 2 MB, and a bundle is ~200 KB. */
export const PUSH_MAX_BYTES = 1_900_000;

export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_NOT_MODIFIED = 304;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_METHOD_NOT_ALLOWED = 405;
export const HTTP_CONFLICT = 409;
export const HTTP_PRECONDITION_FAILED = 412;
export const HTTP_PAYLOAD_TOO_LARGE = 413;

/**
 * Content Security Policy for the site's HTML (audit O14). `connect-src` is the privacy control: a page can only talk
 * to its own origin and the price relay, so nothing (even an injected script) can send data to a third party.
 * Inline scripts are allowed because Next's static export inlines its bootstrap; wasm-unsafe-eval is for the
 * payout-address check (@kakure/zaddr-wasm). Add a host here only together with the feature that needs it.
 */
export const RELAY_ORIGIN = "kakure-prices.kakure-price-relay.workers.dev";
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://${RELAY_ORIGIN} wss://${RELAY_ORIGIN}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()";
