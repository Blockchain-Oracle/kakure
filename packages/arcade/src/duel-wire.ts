import type { DuelPick } from "./duel";

/**
 * The Duel's API (plan §0 R5) under `/arcade/v1/duel/`, forwarded by the site worker like the rest of the arcade (no
 * IP, no headers). Every call that names a key is a POST signed by that key, carrying the `action` it is for and `at`
 * (unix seconds, good for `SIGNED_SKEW_SEC` either side), so it can't be replayed later or as another call, and a key
 * never sits in a path. Picks travel only as a commitment until both players are locked in.
 */
export const DUEL_PATH = "/duel";

/** What a signed Duel request is for; it's part of what's signed. */
export type DuelAction = "state" | "history" | "queue" | "leave" | "commit" | "reveal";

export interface DuelCard {
  /** The Window's id, e.g. `btc-5m-1792504500`. */
  window: string;
  asset: string;
  intervalSec: number;
  expirySec: number;
}

/**
 * `POST /duel/state` (signed): where this key stands, and how many wait. Polling it while waiting keeps your place.
 * `paired` means a duel that needs your picks or your reveal; one only waiting on its Windows leaves you free to queue.
 */
export type DuelState =
  | { status: "idle"; waiting: number; rating: number }
  | { status: "waiting"; waiting: number; rating: number; waitedSec: number }
  | { status: "paired"; waiting: number; rating: number; matchId: string; seat: 0 | 1 };

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

/** `POST /duel/state`, `/duel/history`, `/duel/queue` and `/duel/leave`: the key and the call, signed. */
export interface DuelKeyRequest {
  action: "state" | "history" | "queue" | "leave";
  player: string;
  at: number;
}

export interface DuelCommitRequest {
  action: "commit";
  player: string;
  matchId: string;
  commitment: string;
  at: number;
}

export interface DuelRevealRequest {
  action: "reveal";
  player: string;
  matchId: string;
  picks: DuelPick[];
  salt: string;
  at: number;
}
