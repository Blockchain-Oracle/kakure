import type { DuelPick } from "./duel";

/**
 * The Duel's API (plan §0 R5) under `/arcade/v1/duel/`, forwarded by the site worker like the rest of the arcade (no
 * IP, no headers). Writes are signed by the device key and carry `at` (unix seconds), so an old request can't be
 * replayed later. Picks travel only as a commitment until both players are locked in.
 */
export const DUEL_PATH = "/duel";
/** A signed duel request is good for this long either side of the service's clock. */
export const DUEL_CLOCK_SKEW_SEC = 120;

export interface DuelCard {
  /** The Window's id, e.g. `btc-5m-1792504500`. */
  window: string;
  asset: string;
  intervalSec: number;
  expirySec: number;
}

/** `GET /duel/state/<player>`: where this key stands, and how many wait. */
export type DuelState =
  | { status: "idle"; waiting: number; rating: number }
  | { status: "waiting"; waiting: number; rating: number; waitedSec: number }
  | { status: "paired"; waiting: number; rating: number; matchId: string };

export type DuelStatus = "picking" | "revealing" | "settling" | "final" | "forfeit" | "void";

export interface DuelSeat {
  nickname: string;
  rating: number;
  committed: boolean;
  revealed: boolean;
  /** The picks once both are revealed; null before. */
  picks: (DuelPick | null)[] | null;
  /** Right calls so far, over decided cards. */
  right: number;
  /** The rating change once the duel is final or forfeited. */
  delta: number | null;
}

/** `GET /duel/match/<id>`: the match as either player (or anyone) may see it. */
export interface DuelMatchView {
  id: string;
  status: DuelStatus;
  deck: DuelCard[];
  /** Each card's signed outcome once its Window settles. */
  outcomes: ("U" | "D" | "refund" | null)[];
  seats: [DuelSeat, DuelSeat];
  /** Seconds left to commit or to reveal; null once past both. */
  pickLeftSec: number | null;
  revealLeftSec: number | null;
  /** 0 or 1 for the winning seat, null for a draw or before the end. */
  winner: 0 | 1 | null;
  day: number;
}

export interface DuelBoardRow {
  nickname: string;
  rating: number;
  won: number;
  finished: number;
}

export interface DuelRecent {
  a: string;
  b: string;
  /** The winner's nickname, or null for a draw or a void. */
  winner: string | null;
  status: DuelStatus;
  day: number;
}

/** One of this key's duels, newest first. */
export interface DuelHistoryRow {
  matchId: string;
  opponent: string;
  result: "won" | "lost" | "draw" | "void" | "live";
  delta: number | null;
  day: number;
}

export interface DuelQueueRequest {
  player: string;
  at: number;
}

export interface DuelCommitRequest {
  player: string;
  matchId: string;
  commitment: string;
  at: number;
}

export interface DuelRevealRequest {
  player: string;
  matchId: string;
  picks: DuelPick[];
  salt: string;
  at: number;
}
