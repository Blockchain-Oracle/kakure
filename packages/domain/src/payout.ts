import {
  BPS_DENOMINATOR,
  CANONICAL_MULTIPLIERS,
  FEE_BPS,
  MIN_TICKETS_PER_SIDE,
  PAYOUT_GRID_ZAT,
  REFUND_MIN_ZAT,
  TICKET_SIZES_ZAT,
} from "./constants";

const HALF = 2n;
const DECIMAL_BASE = 10n;

export interface PoolSide {
  tickets: number;
  zat: bigint;
}

export type Settlement =
  | { kind: "settle"; winningPoolZat: bigint; losingPoolZat: bigint }
  | { kind: "refund"; reason: "thin-pool" | "no-winner" };

/**
 * Settle only if each side has at least MIN_TICKETS_PER_SIDE tickets at the cutoff (PD20);
 * otherwise every ticket is refunded. That covers the one-sided pool and the lone winner.
 */
export function settlement(winning: PoolSide, losing: PoolSide): Settlement {
  if (winning.tickets < MIN_TICKETS_PER_SIDE || losing.tickets < MIN_TICKETS_PER_SIDE) {
    return { kind: "refund", reason: "thin-pool" };
  }
  if (winning.zat === 0n) {
    return { kind: "refund", reason: "no-winner" };
  }
  return { kind: "settle", winningPoolZat: winning.zat, losingPoolZat: losing.zat };
}

/**
 * Parimutuel payout for one winning ticket of `sizeZat` (plan §3, §13.1):
 *   stake + stake × losing × (1 − fee) / winning, rounded to the nearest PAYOUT_GRID_ZAT.
 * BigInt is arbitrary precision, so the product can't overflow (Rust uses u128 for the same reason).
 * The fee comes from the losing side only; the house float absorbs the rounding in either direction.
 */
export function payoutZat(sizeZat: bigint, winningPoolZat: bigint, losingPoolZat: bigint): bigint {
  if (!TICKET_SIZES_ZAT.includes(sizeZat)) {
    throw new RangeError(`Not a ticket size: ${sizeZat}`);
  }
  if (winningPoolZat <= 0n || losingPoolZat < 0n) {
    throw new RangeError("Pools must be positive");
  }
  const numerator = sizeZat * losingPoolZat * (BPS_DENOMINATOR - FEE_BPS);
  const denominator = winningPoolZat * BPS_DENOMINATOR;
  const winnings = roundToGrid(numerator, denominator);
  return sizeZat + winnings;
}

/** What a ticket would pay if its side wins, as the pools stand now. */
export interface TicketQuote {
  /** Total paid back (stake included), on the payout grid. */
  payoutZat: bigint;
  /** Payout ÷ stake in basis points (19000 = "pays 1.9×"). */
  multipleBps: bigint;
  /** Payout minus stake. */
  profitZat: bigint;
}

/**
 * The ticket's own quote (plan §0 R2): `payoutZat(s, W + s, L)`, with the bettor's stake added to their side's pool.
 * Using the payout formula itself, grid rounding included, means the ticket never shows a multiple the operator
 * would not pay. `sidePoolZat` / `otherPoolZat` are the last released totals; an empty other side pays the stake back.
 */
export function quoteTicket(sizeZat: bigint, sidePoolZat: bigint, otherPoolZat: bigint): TicketQuote {
  const payout = payoutZat(sizeZat, sidePoolZat + sizeZat, otherPoolZat);
  return {
    payoutZat: payout,
    multipleBps: (payout * BPS_DENOMINATOR) / sizeZat,
    profitZat: payout - sizeZat,
  };
}

/** A refund returns the full stake; wrong amounts under REFUND_MIN_ZAT are kept as dust (plan §13.3). */
export function refundZat(receivedZat: bigint): bigint {
  return receivedZat >= REFUND_MIN_ZAT ? receivedZat : 0n;
}

/**
 * Splits an amount into canonical notes (1, 2 or 5 × 10^k zatoshi), largest first, so every payout note
 * looks like ZIP 318 migration traffic and a lone winner's total can't be matched on exit (L03/L04).
 * Each note is then sent as its own transaction at a random time inside the payout window.
 */
export function canonicalNotes(amountZat: bigint): bigint[] {
  if (amountZat < 0n) {
    throw new RangeError("Amounts are never negative");
  }
  const notes: bigint[] = [];
  let rest = amountZat;
  for (let unit = largestPowerOfTen(rest); unit >= 1n && rest > 0n; unit /= DECIMAL_BASE) {
    for (const multiplier of CANONICAL_MULTIPLIERS) {
      const note = multiplier * unit;
      while (rest >= note) {
        notes.push(note);
        rest -= note;
      }
    }
  }
  return notes;
}

/** Rounds numerator/denominator to the nearest multiple of PAYOUT_GRID_ZAT (half rounds up). */
function roundToGrid(numerator: bigint, denominator: bigint): bigint {
  const gridDenominator = denominator * PAYOUT_GRID_ZAT;
  const steps = (numerator * HALF + gridDenominator) / (gridDenominator * HALF);
  return steps * PAYOUT_GRID_ZAT;
}

function largestPowerOfTen(value: bigint): bigint {
  let unit = 1n;
  while (unit * DECIMAL_BASE <= value) {
    unit *= DECIMAL_BASE;
  }
  return unit;
}
