import type { Network } from "@kakure/domain";

/**
 * The operator's Ed25519 public keys, pinned in the build and never fetched (plan §2, §13.11).
 * Hex, 32 bytes (64 characters), one per network because the operator runs one process per network.
 *
 * LEAD: fill these in when the operator publishes its keys. Until then every published file is
 * rejected with "This build has no operator key pinned", which is the honest state: unverified data is never shown.
 */
export const OPERATOR_PUBLIC_KEYS: Readonly<Record<Network, string | null>> = {
  mainnet: null,
  testnet: null,
};

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
