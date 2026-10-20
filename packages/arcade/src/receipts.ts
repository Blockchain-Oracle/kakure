import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ArcadeGame } from "./field";

/**
 * Bets and profiles (plan §0 R7 under v2): the opt-in board of published positions, and a nickname's public profile.
 *
 * A position can be published once it's paid, when it was a single Up or Down on a Window that decided Up or Down and
 * whose signed figures show at least `RECEIPT_MIN_TRADES` trades (it was one of a crowd). What's sent is the operator's
 * signed certificate under your nickname; the arcade service checks it and keeps only the receipt id (a hash of the
 * position's lock), whether the call was right, and the day it was published. The board shows right calls and calls
 * per nickname with at least `BETS_MIN_RECEIPTS` receipts, counting those published before today: never a market, a
 * side, a size or a P&L. Kakure's operator can still match a published position to its trade; the sheet says so.
 */
export const RECEIPT_MIN_TRADES = 3;
export const BETS_MIN_RECEIPTS = 5;
export const BETS_PERIODS = ["week", "all"] as const;
export type BetsPeriod = (typeof BETS_PERIODS)[number];

/** `POST /arcade/v1/receipt`: a paid position's certificate (the operator's signed JSON), signed by the arcade key. */
export interface ReceiptPublish {
  action: "publish";
  player: string;
  certificate: Record<string, unknown>;
  at: number;
}

/** `POST /arcade/v1/receipt/retract`: takes a published receipt off the board. */
export interface ReceiptRetract {
  action: "retract";
  player: string;
  receipt: string;
  at: number;
}

export interface ReceiptAccepted {
  receipt: string;
  right: boolean;
}

export interface BetsRow {
  nickname: string;
  right: number;
  calls: number;
}

/** `GET /arcade/v1/bets/<period>`: the board on the network whose operator signs the certificates it accepts. */
export interface BetsBoard {
  network: string;
  period: BetsPeriod;
  /** Receipts published before this day (`YYYYMMDD`, UTC) count: the board is recomputed daily. */
  beforeDay: number;
  rows: BetsRow[];
}

/** A receipt's id: the same for every certificate a position's lock was issued (a reduced position counts once). */
export function receiptId(lock: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`kakure-receipt:${lock}`)));
}

/** `POST /arcade/v1/profile` with `{ nickname }`: what a nickname has done in public, and the badges it earns. */
export interface Profile {
  nickname: string;
  /** Signed in with X: the nickname is this X handle. */
  x: boolean;
  duel: { rating: number; won: number; finished: number } | null;
  arcade: Partial<Record<ArcadeGame, { best: number; rank: number }>>;
  bets: { right: number; calls: number } | null;
  badges: Badge[];
}

export type Badge =
  | "duelist"
  | "ladder"
  | "podium-line-rider"
  | "podium-candle-hop"
  | "top10-line-rider"
  | "top10-candle-hop"
  | "caller"
  | "sharp";

const LADDER_RATING = 1_100;
const PODIUM = 3;
const TOP_TEN = 10;
const SHARP_CALLS = 10;
const SHARP_RATE = 0.6;

/** Badges come only from public play: duels, arcade ranks and published receipts. */
export function profileBadges(p: Pick<Profile, "duel" | "arcade" | "bets">): Badge[] {
  const badges: Badge[] = [];
  if (p.duel && p.duel.finished > 0) badges.push("duelist");
  if (p.duel && p.duel.rating >= LADDER_RATING) badges.push("ladder");
  for (const game of ["line-rider", "candle-hop"] as const) {
    const rank = p.arcade[game]?.rank;
    if (rank !== undefined && rank <= PODIUM) badges.push(`podium-${game}`);
    else if (rank !== undefined && rank <= TOP_TEN) badges.push(`top10-${game}`);
  }
  if (p.bets && p.bets.calls >= BETS_MIN_RECEIPTS) badges.push("caller");
  if (p.bets && p.bets.calls >= SHARP_CALLS && p.bets.right / p.bets.calls >= SHARP_RATE) badges.push("sharp");
  return badges;
}
