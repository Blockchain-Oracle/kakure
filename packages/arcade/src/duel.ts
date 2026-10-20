import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * The free Duel (plan §0 R5; Mitoshi core `games/{rating,matchmaking,scoring}.ts`, from Masayume): two nicknames, the
 * same deck of three live Windows, a call on each. Picks are committed as hashes before the lock and revealed after
 * both are in, so neither the opponent nor the arcade service sees a pick before both are locked (Owarine showed picks
 * as they were made). Each card is scored on its Window's signed outcome; more correct calls wins; a refund decides
 * nothing. Elo moves the ladder: K 48 for the first ten verified duels, then 24. No stake rides on it.
 */
export type DuelPick = "up" | "down";

export const DUEL_DECK_SIZE = 3;
/** How long both players have to commit their picks once paired. */
export const DUEL_PICK_SEC = 75;
/** How long each has to reveal once both commitments are in (the browser reveals at once). */
export const DUEL_REVEAL_SEC = 60;
/** A card needs this long before its Window stops taking entries, so a pick made at the deadline is still before it. */
export const DUEL_CARD_MIN_LIFE_SEC = 180;
/** Cards close within this long, so a duel resolves in one sitting. */
export const DUEL_HORIZON_SEC = 1_800;

export const INITIAL_RATING = 1_000;
export const PROVISIONAL_DUELS = 10;
export const K_PROVISIONAL = 48;
export const K_ESTABLISHED = 24;
const ELO_SPREAD = 400;
const ELO_BASE = 10;

/** Matchmaking (Flicky's widening band): ±100 at once, +50 every 15 s, never past ±400. */
export const BASE_BAND = 100;
export const WIDEN_BY = 50;
export const WIDEN_EVERY_SEC = 15;
export const MAX_BAND = 400;

/** The search band after waiting this long. */
export function searchBand(waitedSec: number): number {
  if (waitedSec <= 0) return BASE_BAND;
  return Math.min(MAX_BAND, BASE_BAND + WIDEN_BY * Math.floor(waitedSec / WIDEN_EVERY_SEC));
}

export interface QueueEntry {
  player: string;
  rating: number;
  queuedAt: number;
}

/** Two entries can pair when their ratings sit within the wider of their two bands. */
export function isCompatible(a: QueueEntry, b: QueueEntry, nowSec: number): boolean {
  if (a.player === b.player) return false;
  const band = Math.max(searchBand(nowSec - a.queuedAt), searchBand(nowSec - b.queuedAt));
  return Math.abs(a.rating - b.rating) <= band;
}

/** The compatible entry that has waited longest, so the queue drains oldest first. */
export function findOpponent<T extends QueueEntry>(self: T, queue: readonly T[], nowSec: number): T | null {
  let best: T | null = null;
  for (const candidate of queue) {
    if (!isCompatible(self, candidate, nowSec)) continue;
    if (!best || candidate.queuedAt < best.queuedAt) best = candidate;
  }
  return best;
}

/** A Window as the deck dealer reads it from the signed bundle. */
export interface DuelCandidate {
  id: string;
  asset: string;
  intervalSec: number;
  expirySec: number;
  trading: boolean;
}

/**
 * The deck: three Windows trading now with real life left before entry closes and closing within the horizon,
 * soonest first, one per asset where the venue allows, so the duel is three different questions.
 */
export function dealDuelDeck(
  candidates: readonly DuelCandidate[],
  nowSec: number,
  entryBufferSec: number,
): DuelCandidate[] {
  const eligible = candidates
    .filter(
      (c) =>
        c.trading &&
        c.expirySec - entryBufferSec - nowSec >= DUEL_CARD_MIN_LIFE_SEC &&
        c.expirySec - nowSec <= DUEL_HORIZON_SEC,
    )
    .sort((a, b) => a.expirySec - b.expirySec || a.id.localeCompare(b.id));
  const deck: DuelCandidate[] = [];
  for (const c of eligible) if (deck.length < DUEL_DECK_SIZE && !deck.some((d) => d.asset === c.asset)) deck.push(c);
  for (const c of eligible) if (deck.length < DUEL_DECK_SIZE && !deck.includes(c)) deck.push(c);
  return deck.length === DUEL_DECK_SIZE ? deck : [];
}

/** The commitment a player sends before the lock: SHA-256 of the match, the player, the picks and a secret salt. */
export function duelCommitment(input: {
  matchId: string;
  player: string;
  picks: readonly DuelPick[];
  salt: string;
}): string {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(`kakure-duel:${input.matchId}:${input.player}:${input.picks.join(",")}:${input.salt}`),
    ),
  );
}

/** A card's verdict for one pick: right, wrong, or nothing when the Window refunded. */
export type CardVerdict = "right" | "wrong" | "void";

export function cardVerdict(pick: DuelPick | null, outcome: "U" | "D" | "refund"): CardVerdict {
  if (outcome === "refund") return "void";
  if (pick === null) return "wrong";
  return (pick === "up") === (outcome === "U") ? "right" : "wrong";
}

/** 1 for a win, 0.5 for a draw, 0 for a loss, from player A's side. */
export type DuelScore = 1 | 0.5 | 0;
const DRAW = 0.5;

/** The duel's result once every card is decided: who called more right; null when every card was a refund. */
export function duelScore(
  a: readonly (DuelPick | null)[],
  b: readonly (DuelPick | null)[],
  outcomes: readonly ("U" | "D" | "refund")[],
): { a: number; b: number; score: DuelScore | null } {
  let right = { a: 0, b: 0 };
  let decided = 0;
  outcomes.forEach((outcome, i) => {
    if (outcome === "refund") return;
    decided += 1;
    right = {
      a: right.a + (cardVerdict(a[i] ?? null, outcome) === "right" ? 1 : 0),
      b: right.b + (cardVerdict(b[i] ?? null, outcome) === "right" ? 1 : 0),
    };
  });
  if (decided === 0) return { ...right, score: null };
  return { ...right, score: right.a === right.b ? DRAW : right.a > right.b ? 1 : 0 };
}

export interface RatingRecord {
  rating: number;
  /** Duels that reached a result; a refunded one isn't counted. */
  verified: number;
}

export const kFactor = (r: RatingRecord): number => (r.verified < PROVISIONAL_DUELS ? K_PROVISIONAL : K_ESTABLISHED);

export const expectedScore = (rating: number, opponent: number): number =>
  1 / (1 + ELO_BASE ** ((opponent - rating) / ELO_SPREAD));

/** Both players' new ratings after a verified result (whole numbers; not strictly zero-sum while one is provisional). */
export function applyDuelResult(
  a: RatingRecord,
  b: RatingRecord,
  scoreForA: DuelScore,
): { a: RatingRecord; b: RatingRecord } {
  const scoreForB = 1 - scoreForA;
  return {
    a: {
      rating: Math.round(a.rating + kFactor(a) * (scoreForA - expectedScore(a.rating, b.rating))),
      verified: a.verified + 1,
    },
    b: {
      rating: Math.round(b.rating + kFactor(b) * (scoreForB - expectedScore(b.rating, a.rating))),
      verified: b.verified + 1,
    },
  };
}
