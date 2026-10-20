import type { Network } from "@kakure/domain";

/**
 * The arcade service's settings. It listens on `PORT` and reads the signed prints files from the site (`DATA_ORIGIN`,
 * the same files every visitor gets), verified against the operator key pinned in the build; a development operator's
 * key can stand in through `KAKURE_OPERATOR_KEY_<NETWORK>`.
 */
export const PORT = Number(process.env.PORT ?? 8796);
export const DATA_ORIGIN = (process.env.DATA_ORIGIN ?? "https://kakure-web.kakure-price-relay.workers.dev").replace(
  /\/$/,
  "",
);
/** Tapes ride the network whose operator is live; venue prices are the same on both. */
export const TAPE_NETWORK: Network = process.env.TAPE_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const DB_PATH = process.env.ARCADE_DB ?? "arcade.sqlite";
export const DEV_KEYS: Partial<Record<Network, string>> = {
  ...(process.env.KAKURE_OPERATOR_KEY_TESTNET ? { testnet: process.env.KAKURE_OPERATOR_KEY_TESTNET } : {}),
  ...(process.env.KAKURE_OPERATOR_KEY_MAINNET ? { mainnet: process.env.KAKURE_OPERATOR_KEY_MAINNET } : {}),
};

/** A request body larger than this is refused unread (a 30-minute trace is under 30 KB). */
export const BODY_MAX_BYTES = 64 * 1024;
/** A seed is good for one score, within the longest run plus time to start it and to post (Mitoshi's grace). */
export const SEED_GRACE_SEC = 1_800;
/** Runs a player may post in an hour (Mitoshi: 120 a wallet); counted per hour, the count dropped when it passes. */
export const PER_PLAYER_PER_HOUR = 120;
/** A fetch from the site gives up after this long. */
export const FETCH_TIMEOUT_MS = 10_000;
/** At most this many seeds are outstanding at once; past it a new run is refused until some are posted or expire. */
export const SEEDS_MAX = 20_000;
/** The latest bundle is read again after this long; prints files never change, so they're kept. */
export const LATEST_TTL_MS = 60_000;
/** Hours of prints files read for a tape: the twelve it spans, and one more for the hour still being written. */
export const PRINTS_HOURS = 13;
export const HOUR_SEC = 3_600;
/** A Duel card with no signed outcome in the bundle or its hour's prints this long after its close is a refund. */
export const DUEL_OUTCOME_GRACE_SEC = 3 * HOUR_SEC;
export const DAY_SEC = 86_400;
export const WEEK_DAYS = 7;
