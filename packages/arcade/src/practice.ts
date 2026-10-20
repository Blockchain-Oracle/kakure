/**
 * Practice, "Beat the coin" (plan §0 R4; Mitoshi core `games/practice.ts`, from Masayume): pure rules for the deck, the
 * coin and the score. It sits beside the arcade engines because both are games logic with no money in it.
 */
/** Every card closes 30 s after its own swipe; a card must outlast the swipes (90 s) and the watch. */
export const PRACTICE_WATCH_SEC = 30;
const PRACTICE_SWIPE_BUDGET_SEC = 90;
export const PRACTICE_CARD_MIN_LIFE_SEC = PRACTICE_SWIPE_BUDGET_SEC + PRACTICE_WATCH_SEC;
export const PRACTICE_DECK_MAX = 5;
const MS_PER_SEC = 1_000;
const E8_PLACES = 8;
const E8 = 100_000_000n;
/** The race rows show the move to thousandths of a percent. */
const MOVE_SCALE = 100_000n;
const MOVE_DIVISOR = 1_000;
const MOVE_DECIMALS = 3;
/** FNV-1a (32-bit) and an avalanche, so the coin's hand is a function of the seed and the card. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_AVALANCHE = 0x2545f491;
const AVALANCHE_A = 15;
const AVALANCHE_B = 13;
const TOP_BIT = 31;
/** FNV-1a's 32-bit prime (16777619) as shifts, so the sum stays inside 32-bit integers. */
const PRIME_SHIFT_1 = 1;
const PRIME_SHIFT_4 = 4;
const PRIME_SHIFT_7 = 7;
const PRIME_SHIFT_8 = 8;
const PRIME_SHIFT_24 = 24;

/**
 * Practice as pure data (Mitoshi core `games/practice.ts`, from Masayume): the deck a player learns the motion on, the
 * opponent that is a coin flip, and the rule that scores a card with no money, no chain and no invented number.
 *
 * What practice is honest about: a card asks a live Window's question, and practice answers it on the live public price
 * 30 s after the swipe, not at the Window's settlement. Every price is a real feed reading; a card whose close couldn't
 * be read stays unscored rather than being given a number.
 */
export type PracticeSide = "up" | "down";

export interface DeckCard {
  index: number;
  marketId: string;
  asset: string;
  intervalSec: number;
  expirySec: number;
}

/** A live Window as practice needs it: no spread, no depth, because practice places no order. */
export interface PracticeCandidate {
  marketId: string;
  asset: string;
  intervalSec: number;
  expirySec: number;
  trading: boolean;
}

/** One swipe: the side, and the real feed reading at that moment (an exact price in 1e-8). */
export interface PracticePick {
  cardIndex: number;
  side: PracticeSide;
  entryE8: bigint;
  atMs: number;
}

export interface PracticeClose {
  cardIndex: number;
  closeE8: bigint;
}

export type PracticeMove = "up" | "down" | "flat";
export type PracticeCardResult = "won" | "lost" | "flat";
export type PracticePhase = "dealt" | "picking" | "watching" | "scored";

export interface PracticeRound {
  phase: PracticePhase;
  /** The coin's whole hand is a function of this and the card index. */
  seed: string;
  cards: readonly DeckCard[];
  picks: readonly PracticePick[];
  watchEndsAtMs: number | null;
  closes: readonly PracticeClose[];
}

export type PracticeEvent =
  | { kind: "deal"; seed: string; cards: readonly DeckCard[] }
  | { kind: "pick"; pick: PracticePick }
  | { kind: "close"; close: PracticeClose }
  | { kind: "score" };

export const PRACTICE_IDLE: PracticeRound = {
  phase: "dealt",
  seed: "",
  cards: [],
  picks: [],
  watchEndsAtMs: null,
  closes: [],
};

/**
 * The opponent, and the whole of it: FNV-1a over the seed and the card index, avalanched, then the top bit. A coin
 * flip, and the stage says so (the low bit of FNV-1a only XORs the inputs' low bits, so the top bit is taken).
 */
export function practiceBotSide(seed: string, cardIndex: number): PracticeSide {
  const input = `${seed}:${cardIndex}`;
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash =
      (hash +
        (hash << PRIME_SHIFT_1) +
        (hash << PRIME_SHIFT_4) +
        (hash << PRIME_SHIFT_7) +
        (hash << PRIME_SHIFT_8) +
        (hash << PRIME_SHIFT_24)) >>>
      0;
  }
  hash ^= hash >>> AVALANCHE_A;
  hash = Math.imul(hash, FNV_AVALANCHE) >>> 0;
  hash ^= hash >>> AVALANCHE_B;
  return hash >>> TOP_BIT === 0 ? "up" : "down";
}

/** Which way the feed went between the swipe and the close. Flat is a real third answer. */
export function practiceMove(entryE8: bigint, closeE8: bigint): PracticeMove {
  if (closeE8 > entryE8) return "up";
  if (closeE8 < entryE8) return "down";
  return "flat";
}

/** A flat feed is nobody's win: two players on opposite sides both lose it. */
export function practiceResult(side: PracticeSide, entryE8: bigint, closeE8: bigint): PracticeCardResult {
  const move = practiceMove(entryE8, closeE8);
  if (move === "flat") return "flat";
  return move === side ? "won" : "lost";
}

/** The cards practice can deal: trading now and still trading when the round ends, soonest-settling first. */
export function selectPracticeDeck(candidates: readonly PracticeCandidate[], nowSec: number): readonly DeckCard[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => c.trading && c.expirySec - nowSec > PRACTICE_CARD_MIN_LIFE_SEC)
    .sort((a, b) => a.expirySec - b.expirySec || a.marketId.localeCompare(b.marketId))
    .filter((c) => {
      if (seen.has(c.marketId)) return false;
      seen.add(c.marketId);
      return true;
    })
    .slice(0, PRACTICE_DECK_MAX)
    .map((c, index) => ({
      index,
      marketId: c.marketId,
      asset: c.asset,
      intervalSec: c.intervalSec,
      expirySec: c.expirySec,
    }));
}

/** The next card to swipe, in the deck's order; null when it's played out. */
export function nextPracticeCard(round: PracticeRound): DeckCard | null {
  const picked = new Set(round.picks.map((p) => p.cardIndex));
  return round.cards.find((card) => !picked.has(card.index)) ?? null;
}

/** The reducer, total: a replayed event (a re-render, a double-fired gesture) is a no-op, never a second entry. */
export function practiceTransition(round: PracticeRound, event: PracticeEvent): PracticeRound {
  if (event.kind === "deal") {
    return { phase: "dealt", seed: event.seed, cards: event.cards, picks: [], watchEndsAtMs: null, closes: [] };
  }
  if (event.kind === "pick") {
    if (round.phase !== "dealt" && round.phase !== "picking") return round;
    if (!round.cards.some((card) => card.index === event.pick.cardIndex)) return round;
    if (round.picks.some((p) => p.cardIndex === event.pick.cardIndex)) return round;
    const picks = [...round.picks, event.pick];
    if (picks.length < round.cards.length) return { ...round, phase: "picking", picks };
    return { ...round, phase: "watching", picks, watchEndsAtMs: event.pick.atMs + PRACTICE_WATCH_SEC * MS_PER_SEC };
  }
  if (event.kind === "close") {
    if (round.phase !== "picking" && round.phase !== "watching") return round;
    const picked = round.picks.some((p) => p.cardIndex === event.close.cardIndex);
    if (!picked || round.closes.some((c) => c.cardIndex === event.close.cardIndex)) return round;
    return { ...round, closes: [...round.closes, event.close] };
  }
  return round.phase === "watching" ? { ...round, phase: "scored" } : round;
}

/** When a picked card's own race closes: its swipe plus the watch. */
export function practiceClosesAtMs(round: PracticeRound, cardIndex: number): number | null {
  const pick = round.picks.find((p) => p.cardIndex === cardIndex);
  return pick ? pick.atMs + PRACTICE_WATCH_SEC * MS_PER_SEC : null;
}

export interface PracticeCardScore {
  card: DeckCard;
  side: PracticeSide;
  botSide: PracticeSide;
  entryE8: bigint;
  closeE8: bigint;
  move: PracticeMove;
  you: PracticeCardResult;
  bot: PracticeCardResult;
}

export interface PracticeScore {
  cards: readonly PracticeCardScore[];
  youWon: number;
  botWon: number;
  /** Null on a tie, including the one where a flat feed gave neither side anything. */
  winner: "you" | "bot" | null;
}

/** The scoreboard, derived from the readings the round holds. */
export function practiceScore(round: PracticeRound): PracticeScore {
  const closeOf = new Map(round.closes.map((c) => [c.cardIndex, c.closeE8]));
  const cards: PracticeCardScore[] = [];
  for (const pick of round.picks) {
    const card = round.cards.find((c) => c.index === pick.cardIndex);
    const closeE8 = closeOf.get(pick.cardIndex);
    if (!card || closeE8 === undefined) continue;
    const botSide = practiceBotSide(round.seed, pick.cardIndex);
    cards.push({
      card,
      side: pick.side,
      botSide,
      entryE8: pick.entryE8,
      closeE8,
      move: practiceMove(pick.entryE8, closeE8),
      you: practiceResult(pick.side, pick.entryE8, closeE8),
      bot: practiceResult(botSide, pick.entryE8, closeE8),
    });
  }
  cards.sort((a, b) => a.card.index - b.card.index);
  const youWon = cards.filter((c) => c.you === "won").length;
  const botWon = cards.filter((c) => c.bot === "won").length;
  return { cards, youWon, botWon, winner: youWon === botWon ? null : youWon > botWon ? "you" : "bot" };
}

/** The relay's decimal price as an exact integer in 1e-8; null when it isn't a plain positive decimal. */
export function priceE8(text: string | undefined): bigint | null {
  const match = text ? /^(\d+)(?:\.(\d+))?$/.exec(text) : null;
  if (!match) return null;
  const fraction = (match[2] ?? "").slice(0, E8_PLACES).padEnd(E8_PLACES, "0");
  const value = BigInt(match[1] ?? "0") * E8 + BigInt(fraction);
  return value > 0n ? value : null;
}

/** The move as a signed percentage, in integers until it's printed (the race rows). */
export function movePercent(entryE8: bigint, closeE8: bigint): string {
  if (entryE8 === 0n) return "—";
  const value = Number(((closeE8 - entryE8) * MOVE_SCALE) / entryE8) / MOVE_DIVISOR;
  return `${value > 0 ? "+" : ""}${value.toFixed(MOVE_DECIMALS)}%`;
}
