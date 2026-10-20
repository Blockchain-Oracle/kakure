import {
  BPS_SCALE,
  CHIP_GRID_ZAT,
  ERF_A,
  ERF_P,
  HALF,
  HALF_SPREAD_E4,
  INVERSE_EPSILON,
  INVERSE_ITERATIONS,
  INVERSE_Z_BOUND,
  LADDER_DECADE,
  LADDER_STEPS,
  MAX_ASK_E4,
  MIN_BID_E4,
  MIN_TAU_SEC,
  PARLAY_CORRELATION_FLOOR_BPS,
  PARLAY_MAX_LEGS,
  PARLAY_MIN_LEGS,
  PARLAY_MIN_PRICE_E8,
  PRE_OPEN_PROBABILITY,
  PRICE_SCALE_E4,
  PRICE_SCALE_E8,
  SLIPPAGE_CUSHION_E4,
  YEAR_SEC,
} from "./constants";
import { entryCutoffSec, type LaneWindow } from "./lanes";

/**
 * The house's public price (plan §00 T3 contract): Mitoshi's fair value `P(Up) = Φ(ln(S/O) / (σ√τ))`
 * (`crypto-world-fair/packages/core/src/fair/agari.ts`) with a published half-spread on each side, on an integer
 * price grid of 1/10,000. Every input is public (the relay's price, the signed reference and σ), so anyone can
 * recompute any quote. The Rust operator mirrors this file (`services/operator/src/fair.rs`); `fixtures/fair.json`
 * keeps the two identical.
 *
 * A quote outside the bounds is refused, never clamped (Mitoshi `maker/quoting.ts` `pairAround`): a clamped ask on a
 * decided Window would pay a near-certain winner more than it risks.
 */

/** Φ(z), Abramowitz–Stegun 7.1.26 (|error| < 1.5·10⁻⁷), exactly as Agari and Mitoshi. */
export function normalCdf(z: number): number {
  const [a1, a2, a3, a4, a5] = ERF_A;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + ERF_P * x);
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? HALF * (1 + erf) : HALF * (1 - erf);
}

/** Φ⁻¹(p) by bisection on `normalCdf` (so it inverts the very Φ the house prices with); p is clamped inside (0, 1). */
export function inverseNormalCdf(p: number): number {
  const target = Math.min(1 - INVERSE_EPSILON, Math.max(INVERSE_EPSILON, p));
  let lo = -INVERSE_Z_BOUND;
  let hi = INVERSE_Z_BOUND;
  for (let i = 0; i < INVERSE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The asset price at which a side's probability reaches `probability` now: the inverse of `fairUp` in the spot. A
 * position breaks even where its bid (probability − half-spread) pays back its stake, so the terminal draws "B/E" at
 * `spotForProbability(side, ask + half-spread, …)`.
 */
export function spotForProbability(
  side: "U" | "D",
  probability: number,
  reference: number,
  sigma: number,
  secondsLeft: number,
): number {
  const scale = sigma * Math.sqrt(Math.max(secondsLeft, MIN_TAU_SEC) / YEAR_SEC);
  const z = inverseNormalCdf(side === "U" ? probability : 1 - probability);
  return reference * Math.exp(z * scale);
}

/** P(Up): the chance the closing print ends above the reference, given the price now and the time left. */
export function fairUp(spot: number, reference: number, sigma: number, secondsLeft: number): number {
  if (!(spot > 0) || !(reference > 0)) throw new Error("the fair price needs positive prices");
  const scale = sigma * Math.sqrt(Math.max(secondsLeft, MIN_TAU_SEC) / YEAR_SEC);
  if (!(scale > 0)) return spot >= reference ? 1 : 0;
  return normalCdf(Math.log(spot / reference) / scale);
}

/* ── Bands (Range and Moonshot) ───────────────────────────────────────────────────────────────────────────────── */

export type BandSide = "in" | "out";

/** A band's edges: at least one; a missing edge is unbounded (Moonshot long is `[K, ∞)`, short is `(0, K]`). */
export interface BandEdges {
  lo: number | null;
  hi: number | null;
}

/**
 * P(in): the chance the closing print lands inside the band, `Φ(z(hi)) − Φ(z(lo))` on the same lognormal as Up/Down.
 * P(close > K) is `fairUp` with K as the line, so P(in) = P(close > lo) − P(close > hi).
 */
export function bandInProbability(spot: number, band: BandEdges, sigma: number, secondsLeft: number): number {
  const above = (edge: number | null, unbounded: number) =>
    edge === null ? unbounded : fairUp(spot, edge, sigma, secondsLeft);
  return Math.max(0, above(band.lo, 1) - above(band.hi, 0));
}

/** A band side's prices now: the same half spread and limits as Up/Down. */
export function quoteBand(
  spot: number,
  band: BandEdges,
  side: BandSide,
  sigma: number,
  secondsLeft: number,
): SideQuote {
  const pIn = bandInProbability(spot, band, sigma, secondsLeft);
  return quoteSide(side === "in" ? pIn : 1 - pIn);
}

/**
 * Moonshot's level: where a one-sided band must start so the house's ask is 1 ÷ reach (×2 pays about twice). Long is
 * "finishes at or above K", short "at or below K". The mint prices the band it's sent; this only aims it.
 */
export function moonshotLevel(
  direction: "long" | "short",
  reach: number,
  spot: number,
  sigma: number,
  secondsLeft: number,
): number {
  const askE4 = Math.round(PRICE_SCALE_E4 / reach);
  const probability = Math.min(1, Math.max(0, (askE4 - HALF_SPREAD_E4) / PRICE_SCALE_E4));
  const scale = sigma * Math.sqrt(Math.max(secondsLeft, MIN_TAU_SEC) / YEAR_SEC);
  // P(close > K) = Φ(ln(S/K)/scale): long wants it at `probability`, short wants its complement there.
  const z = inverseNormalCdf(direction === "long" ? probability : 1 - probability);
  return spot * Math.exp(-z * scale);
}

/**
 * Where a Window is in its life:
 * - `pre`: listed ahead; its opening print is unknown to everyone, so both sides are worth one half.
 * - `opening`: started, its reference not recorded yet (a few seconds): no quotes.
 * - `live`: quoted on the live price until `ENTRY_BUFFER_SEC` before expiry.
 * - `riding`: the last seconds: no trades or closes; positions ride to settlement.
 * - `settled`: its outcome is published.
 */
export type WindowPhase = "pre" | "opening" | "live" | "riding" | "settled";

/** What a quote reads of a Window's published state (a bundle's `WindowState` fits). */
export interface WindowStateLike {
  reference?: string | null | undefined;
  outcome?: string | null | undefined;
}

export function windowPhase(
  window: Pick<LaneWindow, "startSec" | "expirySec">,
  state: WindowStateLike | null | undefined,
  nowSec: number,
): WindowPhase {
  if (state?.outcome) return "settled";
  if (nowSec < window.startSec) return "pre";
  if (nowSec >= entryCutoffSec(window as LaneWindow)) return "riding";
  return state?.reference ? "live" : "opening";
}

/** One side's prices, each null when the house refuses it: the ask to buy, the bid to close. */
export interface SideQuote {
  askE4: number | null;
  bidE4: number | null;
}

/** A side's prices from its fair probability: half a spread either side, on the 1/10,000 grid, in the house's favour. */
export function quoteSide(probability: number): SideQuote {
  const ask = Math.ceil(probability * PRICE_SCALE_E4) + HALF_SPREAD_E4;
  const bid = Math.floor(probability * PRICE_SCALE_E4) - HALF_SPREAD_E4;
  return { askE4: ask <= MAX_ASK_E4 ? ask : null, bidE4: bid >= MIN_BID_E4 ? bid : null };
}

export interface WindowQuote {
  phase: WindowPhase;
  /** P(Up) used, or null when nothing is quoted. */
  pUp: number | null;
  up: SideQuote;
  down: SideQuote;
}

const NONE: SideQuote = { askE4: null, bidE4: null };

/** Both sides of a Window at `nowSec`, from the live price (null while there is none). */
export function quoteWindow(
  window: Pick<LaneWindow, "startSec" | "expirySec">,
  state: WindowStateLike | null | undefined,
  inputs: { spot: number | null; sigma: number | null },
  nowSec: number,
): WindowQuote {
  const phase = windowPhase(window, state, nowSec);
  let pUp: number | null = null;
  if (phase === "pre") pUp = PRE_OPEN_PROBABILITY;
  else if (phase === "live" && state?.reference && inputs.spot !== null && inputs.sigma !== null) {
    pUp = fairUp(inputs.spot, Number(state.reference), inputs.sigma, window.expirySec - nowSec);
  }
  if (pUp === null) return { phase, pUp, up: NONE, down: NONE };
  return { phase, pUp, up: quoteSide(pUp), down: quoteSide(1 - pUp) };
}

function floorToGrid(zat: number): number {
  return Math.floor(zat / CHIP_GRID_ZAT) * CHIP_GRID_ZAT;
}

/**
 * The largest chip-ladder value (1, 2 or 5 × 10^k zatoshi, from the smallest chip) at or under `zat`, and the smallest
 * chip below it. Stakes snap to it, so a stake never encodes a balance and can be paid in exact chips without change
 * (privacy re-audit V3).
 */
export function ladderFloor(zat: number): number {
  let best = CHIP_GRID_ZAT;
  for (let unit = CHIP_GRID_ZAT; unit <= zat; unit *= LADDER_DECADE) {
    for (const step of LADDER_STEPS) if (step * unit <= zat) best = step * unit;
  }
  return best;
}

/** What a winning position pays: the stake divided by the ask, floored to the smallest chip. */
export function sidePayoutZat(stakeZat: number, askE4: number): number {
  return floorToGrid(Math.floor((stakeZat * PRICE_SCALE_E4) / askE4));
}

/** What closing a position pays now: its payout times the bid, floored to the smallest chip. */
export function closeValueZat(payout: number, bidE4: number): number {
  return floorToGrid(Math.floor((payout * bidE4) / PRICE_SCALE_E4));
}

/**
 * A partial close (Reduce): the share of a position sold back, by the mint's rule (operator `fair.rs` reduce_share).
 * The payout sold is floored to the smallest chip and the stake sold floored to the zatoshi; a remainder under one
 * chip goes with it, so the whole position is sold. The rest keeps its ask: the mint signs it again on what's left.
 */
export function reduceShare(
  stakeZat: number,
  payoutZat: number,
  fractionBps: number,
): { soldStakeZat: number; soldPayoutZat: number; full: boolean } {
  const share = floorToGrid(Math.floor((payoutZat * fractionBps) / BPS_SCALE));
  const full = fractionBps >= BPS_SCALE || payoutZat - share < CHIP_GRID_ZAT;
  return {
    soldStakeZat: full ? stakeZat : Math.floor((stakeZat * fractionBps) / BPS_SCALE),
    soldPayoutZat: full ? payoutZat : share,
    full,
  };
}

/** "Pays 1.90×": what each chip staked returns if the side wins. */
export function paysMultiple(priceE4: number): number {
  return PRICE_SCALE_E4 / priceE4;
}

/**
 * The price a trader accepts at most (buy) or at least (close): their quote moved by the slippage tolerance and the
 * fixed cushion. A parlay's price (1/10^8) moves by the tolerance alone.
 */
export function withSlippage(priceE4: number, slippageBps: number, direction: "up" | "down"): number {
  const factor = direction === "up" ? BPS_SCALE + slippageBps : BPS_SCALE - slippageBps;
  const moved = (priceE4 * factor) / BPS_SCALE;
  return direction === "up"
    ? Math.ceil(moved) + SLIPPAGE_CUSHION_E4
    : Math.max(0, Math.floor(moved) - SLIPPAGE_CUSHION_E4);
}

export function parlayWithSlippage(priceE8: number, slippageBps: number): number {
  return Math.ceil((priceE8 * (BPS_SCALE + slippageBps)) / BPS_SCALE);
}

/* ── Parlays ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface ParlayLegPrice {
  askE4: number;
  expirySec: number;
}

export type ParlayPrice = { ok: true; priceE8: number } | { ok: false; reason: "legs" | "long-shot" };

/**
 * The combined price of a parlay's legs (Owarine `combineProb`): the product of their asks, rounded up in the house's
 * favour, never below half the lowest ask when two legs settle at the same instant (correlated), and refused under 1 %.
 */
export function parlayPriceE8(legs: readonly ParlayLegPrice[]): ParlayPrice {
  if (legs.length < PARLAY_MIN_LEGS || legs.length > PARLAY_MAX_LEGS) return { ok: false, reason: "legs" };
  let price = PRICE_SCALE_E8;
  for (const leg of legs) price = Math.ceil((price * leg.askE4) / PRICE_SCALE_E4);
  const expiries = new Set(legs.map((leg) => leg.expirySec));
  if (expiries.size !== legs.length) {
    const lowest = Math.min(...legs.map((leg) => leg.askE4));
    const floor = (lowest * (PRICE_SCALE_E8 / PRICE_SCALE_E4) * PARLAY_CORRELATION_FLOOR_BPS) / BPS_SCALE;
    price = Math.max(price, floor);
  }
  if (price < PARLAY_MIN_PRICE_E8) return { ok: false, reason: "long-shot" };
  return { ok: true, priceE8: price };
}

/**
 * What a winning parlay pays: the stake divided by its combined price, floored to the smallest chip. In BigInt: a
 * 1 ZEC stake times 10^8 passes 2^53.
 */
export function parlayPayoutZat(stakeZat: number, priceE8: number): number {
  return floorToGrid(Number((BigInt(stakeZat) * BigInt(PRICE_SCALE_E8)) / BigInt(priceE8)));
}

/**
 * A settled parlay's value. Any lost leg loses it all. Refunded legs drop out and the rest are priced again with the
 * same rule (one decided leg is priced alone); with every leg refunded, the stake comes back.
 */
export function parlaySettledZat(
  stakeZat: number,
  legs: readonly (ParlayLegPrice & { outcome: "won" | "lost" | "refund" })[],
): number {
  if (legs.some((leg) => leg.outcome === "lost")) return 0;
  const decided = legs.filter((leg) => leg.outcome === "won");
  if (decided.length === 0) return stakeZat;
  if (decided.length === 1) return sidePayoutZat(stakeZat, (decided[0] as ParlayLegPrice).askE4);
  const repriced = parlayPriceE8(decided);
  // Decided legs passed this rule at purchase (as a subset of a valid parlay); a long shot can't appear by removing legs.
  return repriced.ok ? parlayPayoutZat(stakeZat, repriced.priceE8) : stakeZat;
}
