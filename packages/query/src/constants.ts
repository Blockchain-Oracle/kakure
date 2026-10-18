// Pinned in @kakure/domain so the data worker can check pushes without pulling in this package.
export { OPERATOR_PUBLIC_KEYS } from "@kakure/domain";

/** The one mutable file per network; it names the current bundle (PD14). */
export const LATEST_FILE = "latest.json";

/**
 * `latest.json` is cached for 20 s plus 40 s stale-while-revalidate at the edge (services/data-worker),
 * so a fresh bundle can take up to this long to reach a client after it is published.
 */
export const PUBLISH_GRACE_MS = 60_000;

/** When the next bundle is overdue (or nothing is published yet), check this often. */
export const OVERDUE_POLL_MS = 60_000;

/** Transient failures (offline, 5xx) retry this many times with the default backoff. */
export const MAX_RETRIES = 3;

export const HTTP_NOT_FOUND = 404;

/** Ed25519 public key length. */
export const PUBLIC_KEY_HEX_LENGTH = 64;
