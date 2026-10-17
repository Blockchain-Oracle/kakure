import type { Network } from "@kakure/domain";

/**
 * The operator's Ed25519 public keys, pinned in the build and never fetched (plan §2, §13.11).
 * Hex, 32 bytes (64 characters), one per network because the operator runs one process per network.
 *
 * Mainnet is unset until its operator key exists, so mainnet shows "This build has no operator key": unverified
 * data is never shown.
 */
export const OPERATOR_PUBLIC_KEYS: Readonly<Record<Network, string | null>> = {
  /** The mainnet operator's key (base64url sG_wKO_4xxEWnCqkvVhmLuq-rwHxv7RjPlgqhLKFSzs), pinned 2026-10-17. */
  mainnet: "b06ff028eff8c711169c2aa4bd58662eeabeaf01f1bfb4633e582a84b2854b3b",
  /** The testnet operator's key (base64url AJ556QMDemUB-ZxXMaxeegFccD_0tn8QlMqdjx6rw3s), pinned 2026-10-17. */
  testnet: "009e79e903037a6501f99c5731ac5e7a015c703ff4b67f1094ca9d8f1eabc37b",
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
