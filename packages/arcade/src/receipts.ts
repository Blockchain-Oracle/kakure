import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ArcadeGame } from "./field";

/**
 * Bets and profiles (plan §0 R7 under v2, reworked after its privacy reviews): the opt-in board of published calls,
 * and a nickname's public profile.
 *
 * A paid single Up or Down call can be published while its position is in the operator's book (two days after it's
 * paid). The device asks the operator over Oblivious HTTP to vouch for it, sending the position's secret and a blinded
 * random point; the operator checks the call, its Window's outcome and that at least `RECEIPT_MIN_TRADES` singles were
 * opened on that Window, and blind-signs the point under its "right" or its "wrong" key (once per position). The device
 * unblinds it into a receipt only it has seen, and hands that to the arcade, which checks it against the operator's
 * published keys. The operator never sees the receipt or the nickname; the arcade never sees the trade. The board shows
 * right calls and calls per nickname with at least `BETS_MIN_RECEIPTS` receipts and changes once a week (Monday 00:00
 * UTC): never a market, a side, a size or a return.
 */
export const RECEIPT_MIN_TRADES = 3;
export const BETS_MIN_RECEIPTS = 5;
export const BETS_PERIODS = ["week", "all"] as const;
export type BetsPeriod = (typeof BETS_PERIODS)[number];

/**
 * A blind receipt (NUT-00/NUT-12): a random `secret` the device chose, the operator's unblinded signature `C` on it
 * under its `right` or its `wrong` receipt key, and the DLEQ proof with the blinding factor `r`, so anyone holding the
 * operator's published keys can check it, and the operator, who only ever saw the blinded point, can't tell which
 * call it was for.
 */
export interface ReceiptToken {
  v: 2;
  network: string;
  right: boolean;
  secret: string;
  C: string;
  dleq: { e: string; s: string; r: string };
}

/** `POST /arcade/v1/receipt`: a blind receipt, carried and signed by the arcade key it goes up under. */
export interface ReceiptPublish {
  action: "publish";
  player: string;
  token: ReceiptToken;
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

/** `GET /arcade/v1/bets/<week|all>`: last week's calls or every week's, on the network whose operator signs. */
export interface BetsBoard {
  network: string;
  period: BetsPeriod;
  /** Receipts published before this Monday (`YYYYMMDD`, UTC) count: the board changes once a week. */
  beforeDay: number;
  rows: BetsRow[];
}

const DAY_SEC = 86_400;
const WEEK_DAYS = 7;
/** 1970-01-01 was a Thursday: three days on, weeks start on Monday. */
const MONDAY_OFFSET_DAYS = 3;
const MS = 1000;
const DATE_DIGITS = 8;

/** The week (Monday 00:00 UTC on) a time falls in, counted from 1970. */
export function weekOf(sec: number): number {
  return Math.floor((Math.floor(sec / DAY_SEC) + MONDAY_OFFSET_DAYS) / WEEK_DAYS);
}

/** A week's Monday as `YYYYMMDD`. */
export function weekStartDay(week: number): number {
  const day = week * WEEK_DAYS - MONDAY_OFFSET_DAYS;
  return Number(
    new Date(day * DAY_SEC * MS).toISOString().slice(0, "YYYY-MM-DD".length).replaceAll("-", "").slice(0, DATE_DIGITS),
  );
}

/** A receipt's id on the board: a hash of its secret (one receipt per call: the operator vouches for a position once). */
export function receiptId(secret: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`kakure-receipt:${secret}`)));
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
