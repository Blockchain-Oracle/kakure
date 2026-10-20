"use client";

import {
  type BundleV2,
  closeValueZat,
  fairUp,
  LANE_ASSETS,
  type LaneAsset,
  type LaneWindow,
  PRE_OPEN_PROBABILITY,
  parseWindowId,
  quoteBand,
  quoteWindow,
  type WindowPhase,
  windowPhase,
} from "@kakure/domain";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { bandSideOf, type PositionRecord, upDownOf } from "@/features/wallet/records";

/**
 * This device's positions valued live (Owarine `PositionsPanel.tsx` + `position-return.ts`): what closing pays now at
 * the bid, the PnL against the stake and its ROI. A position with no bid (its Window riding to the close, or too far
 * gone to buy back) is "locked": no PnL is invented for it. Parlays can't be sold back; they're marked at fair value
 * (their payout times each open leg's chance), as Owarine marks them.
 */
export type PositionStatus = "buying" | "priced" | "locked" | "settling" | "unpriced";

export interface LivePosition {
  record: PositionRecord;
  key: string;
  kind: "single" | "parlay" | "band";
  asset: LaneAsset | null;
  side: "U" | "D" | null;
  window: LaneWindow | null;
  cadenceSec: number | null;
  phase: WindowPhase | null;
  stakeZat: number;
  payoutZat: number;
  /** The ask it was bought at, in 1/10,000 (singles). */
  askE4: number | null;
  bidE4: number | null;
  status: PositionStatus;
  /** What it's worth now, its PnL and ROI (%); null when it can't be priced. */
  valueZat: number | null;
  pnlZat: number | null;
  roiPct: number | null;
  /** The last moment any of its Windows settles (unix s). */
  settlesSec: number;
  /** A band's edges (unbounded when null) and side; null for anything else. */
  band: { lo: number | null; hi: number | null; side: "in" | "out" } | null;
}

export type Spots = (symbol: StreamSymbol) => number | null;
const PERCENT = 100;

const assetOf = (lane: { asset: string }): LaneAsset | null =>
  (LANE_ASSETS as readonly string[]).includes(lane.asset) ? (lane.asset as LaneAsset) : null;

export function valuePositions(
  records: readonly PositionRecord[],
  bundle: BundleV2 | null,
  spot: Spots,
  nowSec: number,
): LivePosition[] {
  const states = new Map((bundle?.windows ?? []).map((w) => [w.id, w]));
  const sigmaOf = (asset: LaneAsset) => {
    const s = bundle?.pricing.sigma[asset];
    return s ? Number(s) : null;
  };
  const out: LivePosition[] = [];
  for (const record of records) {
    if (record.state === "paid") continue;
    const cert = record.certificate;
    if (!cert) {
      out.push(buying(record));
      continue;
    }
    const stakeZat = Number(cert.stakeZat);
    const payoutZat = Number(cert.payoutZat);
    if (cert.kind === "parlay") {
      out.push(parlay(record, stakeZat, payoutZat, states, spot, sigmaOf, nowSec));
      continue;
    }
    const parsed = cert.window ? parseWindowId(cert.window) : null;
    const asset = parsed ? assetOf(parsed.lane) : null;
    const bandSide = bandSideOf(cert);
    if (cert.kind === "band" && parsed && asset && bandSide) {
      const state = states.get(parsed.window.id) ?? null;
      const phase = windowPhase(parsed.window, state, nowSec);
      const edges = { lo: cert.lo ? Number(cert.lo) : null, hi: cert.hi ? Number(cert.hi) : null };
      const s = spot(`${asset}-USD`);
      const sigma = sigmaOf(asset);
      // Absolute edges need no reference: a band trades while its Window is pre-listed, opening or live.
      const trades = phase === "pre" || phase === "opening" || phase === "live";
      const bidE4 =
        trades && s !== null && sigma !== null
          ? quoteBand(s, edges, bandSide, sigma, parsed.window.expirySec - nowSec).bidE4
          : null;
      const valueZat = bidE4 === null ? null : closeValueZat(payoutZat, bidE4);
      const pnlZat = valueZat === null ? null : valueZat - stakeZat;
      out.push({
        record,
        key: record.key,
        kind: "band",
        asset,
        side: null,
        window: parsed.window,
        cadenceSec: parsed.lane.cadenceSec,
        phase,
        stakeZat,
        payoutZat,
        askE4: cert.askE4 ?? null,
        bidE4,
        status:
          valueZat !== null
            ? "priced"
            : phase === "settled" || nowSec >= parsed.window.expirySec
              ? "settling"
              : "locked",
        valueZat,
        pnlZat,
        roiPct: pnlZat === null || stakeZat === 0 ? null : (pnlZat / stakeZat) * PERCENT,
        settlesSec: parsed.window.expirySec,
        band: { ...edges, side: bandSide },
      });
      continue;
    }
    const side = upDownOf(cert);
    if (!parsed || !asset || !side) {
      out.push({ ...buying(record), status: "unpriced" });
      continue;
    }
    const state = states.get(parsed.window.id) ?? null;
    const phase = windowPhase(parsed.window, state, nowSec);
    const quote = quoteWindow(parsed.window, state, { spot: spot(`${asset}-USD`), sigma: sigmaOf(asset) }, nowSec);
    const bidE4 = (side === "U" ? quote.up : quote.down).bidE4;
    const valueZat = bidE4 === null ? null : closeValueZat(payoutZat, bidE4);
    const pnlZat = valueZat === null ? null : valueZat - stakeZat;
    out.push({
      record,
      key: record.key,
      kind: "single",
      asset,
      side,
      window: parsed.window,
      cadenceSec: parsed.lane.cadenceSec,
      phase,
      stakeZat,
      payoutZat,
      askE4: cert.askE4 ?? null,
      bidE4,
      status:
        valueZat !== null ? "priced" : phase === "settled" || nowSec >= parsed.window.expirySec ? "settling" : "locked",
      valueZat,
      pnlZat,
      roiPct: pnlZat === null || stakeZat === 0 ? null : (pnlZat / stakeZat) * PERCENT,
      settlesSec: parsed.window.expirySec,
      band: null,
    });
  }
  return out;
}

function buying(record: PositionRecord): LivePosition {
  return {
    record,
    key: record.key,
    kind: "single",
    asset: null,
    side: null,
    window: null,
    cadenceSec: null,
    phase: null,
    stakeZat: 0,
    payoutZat: 0,
    askE4: null,
    bidE4: null,
    status: "buying",
    valueZat: null,
    pnlZat: null,
    roiPct: null,
    settlesSec: 0,
    band: null,
  };
}

function parlay(
  record: PositionRecord,
  stakeZat: number,
  payoutZat: number,
  states: Map<string, BundleV2["windows"][number]>,
  spot: Spots,
  sigmaOf: (asset: LaneAsset) => number | null,
  nowSec: number,
): LivePosition {
  const legs = record.certificate?.legs ?? [];
  let chance = 1;
  let priced = true;
  let settles = 0;
  for (const leg of legs) {
    settles = Math.max(settles, leg.expiry);
    const parsed = parseWindowId(leg.window);
    const asset = parsed ? assetOf(parsed.lane) : null;
    const state = states.get(leg.window) ?? null;
    if (!parsed || !asset) {
      priced = false;
      continue;
    }
    if (state?.outcome) {
      chance *= state.outcome === leg.side ? 1 : state.outcome === "refund" ? 1 : 0;
      continue;
    }
    const s = spot(`${asset}-USD`);
    const sigma = sigmaOf(asset);
    const phase = windowPhase(parsed.window, state, nowSec);
    if (phase === "pre") {
      chance *= PRE_OPEN_PROBABILITY;
      continue;
    }
    if (s === null || sigma === null || !state?.reference) {
      priced = false;
      continue;
    }
    const up = fairUp(s, Number(state.reference), sigma, parsed.window.expirySec - nowSec);
    chance *= leg.side === "U" ? up : 1 - up;
  }
  const valueZat = priced ? Math.round(payoutZat * chance) : null;
  const pnlZat = valueZat === null ? null : valueZat - stakeZat;
  return {
    record,
    key: record.key,
    kind: "parlay",
    asset: null,
    side: null,
    window: null,
    cadenceSec: null,
    phase: null,
    stakeZat,
    payoutZat,
    askE4: null,
    bidE4: null,
    status: valueZat === null ? "unpriced" : "priced",
    valueZat,
    pnlZat,
    roiPct: pnlZat === null || stakeZat === 0 ? null : (pnlZat / stakeZat) * PERCENT,
    settlesSec: settles,
    band: null,
  };
}

export interface Totals {
  pnlZat: number;
  stakeZat: number;
  /** Positions with no live value: riding to the close, or settled and waiting for their payout. */
  unpriced: number;
  settling: number;
  count: number;
}

/** The Unrealized card: priced positions only; the rest are counted as unpriced, never as zero. */
export function totalsOf(positions: readonly LivePosition[]): Totals {
  let pnlZat = 0;
  let stakeZat = 0;
  let unpriced = 0;
  let settling = 0;
  for (const p of positions) {
    if (p.status === "buying") continue;
    if (p.status === "settling") settling += 1;
    if (p.pnlZat === null) unpriced += 1;
    else {
      pnlZat += p.pnlZat;
      stakeZat += p.stakeZat;
    }
  }
  return { pnlZat, stakeZat, unpriced, settling, count: positions.filter((p) => p.status !== "buying").length };
}
