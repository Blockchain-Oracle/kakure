/** The arcade identity's figures (plan §0 R4). */

/** An Ed25519 secret key is 32 random bytes. */
export const SECRET_BYTES = 32;
/** The proof of work yields to the page every this many tries, so the sheet keeps drawing (≈ 2^18 tries in all). */
export const POW_YIELD_EVERY = 2_048;
/** Runs this device remembers for History; older ones drop off. */
export const RUNS_KEPT = 60;
/** A board is read again after this long; a standing after a post or this long. */
export const BOARD_STALE_MS = 30_000;
export const STANDING_STALE_MS = 60_000;
/** The attract tape is the same for five minutes on the service (its cache header). */
export const TAPE_STALE_MS = 300_000;
export const HEX_RADIX = 16;
export const MS_PER_SEC = 1_000;
export const HEX_PAD = 2;
/** The longest nickname (the service's NICKNAME_PATTERN: 3–16 characters). */
export const NICKNAME_MAX = 16;
