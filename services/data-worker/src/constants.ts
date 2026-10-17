/** Public data lives under this path; R2 keys are the path after it, e.g. `testnet/latest.json`. */
export const DATA_PREFIX = "/data/";

/** `latest.json` is the only mutable file: short cache plus stale-while-revalidate (plan §2, §13.11). */
export const LATEST_FILE = "latest.json";
export const LATEST_CACHE = "public, max-age=20, stale-while-revalidate=40";

/** Every other published file is content-addressed or numbered, so it never changes. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Networks the operator publishes for. Anything else is rejected before touching R2. */
export const NETWORKS = ["mainnet", "testnet"] as const;

/** R2 keys are `<network>/<file>` with a conservative character set; no traversal, no nesting beyond one folder. */
export const KEY_PATTERN = /^(mainnet|testnet)\/[a-z0-9][a-z0-9._-]{0,127}\.json$/;

/** Headers on every response: no referrer, no sniffing, no framing, nothing cached by intermediaries we don't control. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const HTTP_NOT_MODIFIED = 304;
export const HTTP_NOT_FOUND = 404;
export const HTTP_METHOD_NOT_ALLOWED = 405;
