"use client";

import { HALF_SPREAD_E4, PRICE_SCALE_E4, spotForProbability } from "@kakure/domain";
import { type RefObject, useRef } from "react";
import type { ChartLevel, ChartOverlay } from "./chart/live-chart";
import { BPS } from "./constants";
import { livePnlText, zatToNumber } from "./format";
import type { LivePosition } from "./positions";

/**
 * What the chart draws for the Window on screen (Owarine `useChartFeedback.ts` overlay and `live.ts`
 * `breakEvenSpot`). Flat: the Line (the Window's reference), as Mitoshi draws its line to beat. Holding: the PnL pill,
 * the band from the entry, and the levels Entry, Line, B/E (where the bid pays the stake back) and Trail (the stop the
 * mint holds, from the best price this tab has seen since it was armed). Written to a ref the chart reads every frame. Also: whether TRAIL may be tapped yet (the price has moved
 * the trail distance past break-even), as Owarine's `trailEligible`.
 */
export function useChartOverlay(input: {
  active: LivePosition | null;
  reference: number | null;
  spot: number | null;
  sigma: number | null;
  nowSec: number;
  trailPct: number;
}): { overlay: RefObject<ChartOverlay | null>; breakEven: number | null; canTrail: boolean } {
  const { active, reference, spot, sigma, nowSec, trailPct } = input;
  const best = useRef(new Map<string, number>());
  const overlay = useRef<ChartOverlay | null>(null);

  const side = active?.side ?? null;
  const breakEven =
    active && side && active.askE4 && reference !== null && sigma !== null && active.window
      ? spotForProbability(
          side,
          (active.askE4 + HALF_SPREAD_E4) / PRICE_SCALE_E4,
          reference,
          sigma,
          active.window.expirySec - nowSec,
        )
      : null;

  // The trail's best price since it was armed (this tab's view; the mint keeps its own).
  let trailLevel: number | null = null;
  const trail = active?.record.state === "armed" ? active.record.exit?.trail : undefined;
  if (active && side && trail && spot !== null) {
    const was = best.current.get(active.key) ?? spot;
    const now = side === "U" ? Math.max(was, spot) : Math.min(was, spot);
    best.current.set(active.key, now);
    const away = trail.bps / BPS;
    trailLevel = side === "U" ? now * (1 - away) : now * (1 + away);
  } else if (active) best.current.delete(active.key);

  const lineLevel: ChartLevel[] = reference !== null ? [{ kind: "line", price: reference, label: "Line" }] : [];
  if (!active || !side) {
    // Flat: the Window's line to beat (Mitoshi's `WindowChart`), the price green above it and red below.
    overlay.current =
      reference === null
        ? null
        : { tone: spot === null ? 0 : spot - reference, pnlText: null, entry: null, levels: lineLevel };
  } else {
    const priced = active.pnlZat !== null;
    const winningIfSettledNow =
      reference === null || spot === null ? null : side === "U" ? spot > reference : spot < reference;
    const levels: ChartLevel[] = [];
    if (active.record.entrySpot) levels.push({ kind: "entry", price: active.record.entrySpot, label: "Entry" });
    levels.push(...lineLevel);
    if (breakEven !== null && Number.isFinite(breakEven))
      levels.push({ kind: "breakeven", price: breakEven, label: "B/E" });
    if (trailLevel !== null) levels.push({ kind: "trail", price: trailLevel, label: "Trail" });
    overlay.current = {
      tone: priced ? zatToNumber(active.pnlZat ?? 0) : winningIfSettledNow === false ? -1 : 0,
      pnlText: priced ? livePnlText(zatToNumber(active.pnlZat ?? 0)) : "locked",
      entry: active.record.entrySpot ?? null,
      levels,
    };
  }

  const canTrail =
    breakEven !== null && spot !== null && side !== null
      ? side === "U"
        ? spot >= breakEven * (1 + trailPct)
        : spot <= breakEven * (1 - trailPct)
      : false;
  return { overlay, breakEven, canTrail };
}
