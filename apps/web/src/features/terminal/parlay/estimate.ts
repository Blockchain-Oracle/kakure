import {
  type BundleV2,
  type LaneAsset,
  PARLAY_MIN_LEGS,
  PRICE_SCALE_E4,
  PRICE_SCALE_E8,
  parlayPayoutZat,
  parlayPriceE8,
  parseWindowId,
  quoteWindow,
} from "@kakure/domain";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { zecText } from "../format";
import { legOpen, type SlipLeg } from "./slip";

/**
 * A parlay priced the way the mint prices it (Owarine `parlay/price.ts`, on Kakure's public formula): each leg's live
 * ask from its Window's reference, σ and the streamed price; the asks multiply, rounded in the house's favour, floored
 * when two legs settle together, refused under 1 %; the payout is the stake over that price, capped. So the number on
 * the button is the number the mint quotes, or a requote inside the slippage tolerance.
 */
export interface ParlayQuote {
  priceE8: number;
  payoutZat: number;
  stakeZat: number;
  /** Each leg's ask in 1/10,000, in slip order. */
  legAsksE4: number[];
  /** The chance every leg lands at fair value (0–1). */
  chance: number;
  /** Two legs settle at the same instant and the correlation floor lifted the price. */
  correlated: boolean;
}

export type ParlayEstimate = { ok: true; quote: ParlayQuote } | { ok: false; why: string; legIdx: number | null };

export interface LegLive {
  askE4: number | null;
  /** The leg's fair chance now (0–1), or null with no price. */
  chance: number | null;
  /** Whether the price is on the leg's side of its Line now; null before the Line is set. */
  lead: "ahead" | "behind" | null;
}

/** One leg's live numbers from the bundle and the committed prices. */
export function legLive(
  leg: SlipLeg,
  bundle: BundleV2 | null,
  spotOf: (symbol: StreamSymbol) => number | null,
  nowSec: number,
): LegLive {
  const parsed = parseWindowId(leg.window);
  if (!parsed) return { askE4: null, chance: null, lead: null };
  const state = bundle?.windows.find((w) => w.id === leg.window) ?? null;
  const sigmaText = bundle?.pricing.sigma[leg.asset as LaneAsset];
  const spot = spotOf(`${leg.asset}-USD`);
  const quote = quoteWindow(parsed.window, state, { spot, sigma: sigmaText ? Number(sigmaText) : null }, nowSec);
  const side = leg.side === "U" ? quote.up : quote.down;
  const chance = quote.pUp === null ? null : leg.side === "U" ? quote.pUp : 1 - quote.pUp;
  const line = state?.reference ? Number(state.reference) : null;
  const lead =
    spot === null || line === null ? null : (leg.side === "U" ? spot > line : spot < line) ? "ahead" : "behind";
  return { askE4: side.askE4, chance, lead };
}

/** The ticket a stake buys right now, or why the mint wouldn't sell it, in words. */
export function estimateParlay(input: {
  legs: readonly SlipLeg[];
  live: readonly LegLive[];
  stakeZat: number;
  minStakeZat: number;
  maxPayoutZat: number;
  entryBufferSec: number;
  nowSec: number;
  coin: string;
}): ParlayEstimate {
  const { legs, live, stakeZat, nowSec } = input;
  if (legs.length < PARLAY_MIN_LEGS) {
    return { ok: false, why: legs.length === 0 ? "Add two or three markets" : "Add one more market", legIdx: null };
  }
  if (stakeZat < input.minStakeZat) {
    return { ok: false, why: `The smallest stake is ${zecText(input.minStakeZat)} ${input.coin}`, legIdx: null };
  }
  const asks: number[] = [];
  let chance = 1;
  for (const [i, leg] of legs.entries()) {
    if (!legOpen(leg.expirySec, input.entryBufferSec, nowSec)) {
      return { ok: false, why: "Closes too soon to join a parlay", legIdx: i };
    }
    const l = live[i];
    if (!l || l.askE4 === null) return { ok: false, why: "This leg isn't offered right now", legIdx: i };
    asks.push(l.askE4);
    chance *= l.chance ?? 1;
  }
  const priced = parlayPriceE8(legs.map((leg, i) => ({ askE4: asks[i] ?? 0, expirySec: leg.expirySec })));
  if (!priced.ok) {
    return {
      ok: false,
      why:
        priced.reason === "long-shot" ? "Too long a shot for the house. Swap a leg" : "A parlay holds 2 or 3 markets",
      legIdx: null,
    };
  }
  const payoutZat = parlayPayoutZat(stakeZat, priced.priceE8);
  if (payoutZat > input.maxPayoutZat) {
    return {
      ok: false,
      why: `Pays more than the ${zecText(input.maxPayoutZat)} ${input.coin} cap. Lower the stake`,
      legIdx: null,
    };
  }
  let product = PRICE_SCALE_E8;
  for (const ask of asks) product = Math.ceil((product * ask) / PRICE_SCALE_E4);
  return {
    ok: true,
    quote: {
      priceE8: priced.priceE8,
      payoutZat,
      stakeZat,
      legAsksE4: asks,
      chance,
      correlated: priced.priceE8 > product,
    },
  };
}
