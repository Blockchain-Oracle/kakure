"use client";

import {
  currentAndNext,
  LANES,
  type LaneAsset,
  type LaneWindow,
  PARLAY_LEG_MIN_LEFT_SEC,
  PARLAY_MAX_LEGS,
} from "@kakure/domain";
import { useSyncExternalStore } from "react";

/**
 * The parlay slip (Owarine `parlay/slip.ts`): the terminal's second way to trade. In Parlay mode UP and DOWN add the
 * Window on screen to the slip instead of buying it; the slip survives moving between markets, so a ticket can name BTC,
 * then ETH, then SOL. A leg names one Window; when that Window gets too close to its cutoff to join a ticket, the leg
 * moves to the next Window of the same asset and length that can.
 *
 * Adapted: the slip lives in memory only. Owarine keeps it in localStorage, but it names the sides you're weighing, and
 * Kakure keeps nothing about bets on the device in the clear; a reload starts an empty slip.
 */
export interface SlipLeg {
  window: string;
  asset: LaneAsset;
  cadenceSec: number;
  side: "U" | "D";
  expirySec: number;
}

interface SlipState {
  on: boolean;
  legs: readonly SlipLeg[];
  /** The slip's own stake in zatoshi; null follows the screen's size. */
  stakeZat: number | null;
}

const INITIAL: SlipState = { on: false, legs: [], stakeZat: null };
const listeners = new Set<() => void>();
let state: SlipState = INITIAL;

function commit(next: SlipState): void {
  state = next;
  for (const l of listeners) l();
}

export function useSlip(): SlipState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => INITIAL,
  );
}

export function setParlayOn(on: boolean): void {
  commit({ ...state, on });
}

export function setSlipStake(stakeZat: number | null): void {
  commit({ ...state, stakeZat });
}

export function removeLeg(window: string): void {
  commit({ ...state, legs: state.legs.filter((l) => l.window !== window) });
}

export function clearSlip(): void {
  commit({ ...state, legs: [] });
}

export type ToggleResult = "added" | "flipped" | "removed" | "full";

export function legOf(window: LaneWindow, asset: LaneAsset, cadenceSec: number, side: "U" | "D"): SlipLeg {
  return { window: window.id, asset, cadenceSec, side, expirySec: window.expirySec };
}

/** UP/DOWN in Parlay mode on a Window: add it, flip its side, or (the same side again) take it off. */
export function toggledLegs(
  legs: readonly SlipLeg[],
  leg: SlipLeg,
  max = PARLAY_MAX_LEGS,
): { legs: SlipLeg[]; result: ToggleResult } {
  const at = legs.findIndex((l) => l.window === leg.window);
  if (at >= 0) {
    if (legs[at]?.side === leg.side) return { legs: legs.filter((_, i) => i !== at), result: "removed" };
    return { legs: legs.map((l, i) => (i === at ? { ...l, side: leg.side } : l)), result: "flipped" };
  }
  if (legs.length >= max) return { legs: [...legs], result: "full" };
  return { legs: [...legs, leg], result: "added" };
}

export function toggleLeg(leg: SlipLeg): ToggleResult {
  const next = toggledLegs(state.legs, leg);
  if (next.result !== "full") commit({ ...state, legs: next.legs });
  return next.result;
}

/** A Window can still join a ticket: the mint wants 30 s left before it stops trading (its cutoff). */
export const legOpen = (expirySec: number, entryBufferSec: number, nowSec: number): boolean =>
  expirySec - entryBufferSec - nowSec >= PARLAY_LEG_MIN_LEFT_SEC;

/**
 * Moves every leg whose Window can no longer join to the Window of the same asset and length the screen would show
 * (either series of a 2- or 5-minute length): a started one with the most time left, else the earliest pre-listed one.
 * A Window another leg holds is skipped; a leg with no successor yet stays (the slip says it closes too soon). Returns
 * the same array when nothing moved.
 */
export function rolledLegs(
  legs: readonly SlipLeg[],
  nowSec: number,
  entryBufferSec: number,
): { legs: readonly SlipLeg[]; moved: SlipLeg[] } {
  const used = new Set(legs.map((l) => l.window));
  const moved: SlipLeg[] = [];
  const next = legs.map((leg) => {
    if (legOpen(leg.expirySec, entryBufferSec, nowSec)) return leg;
    const open = LANES.filter((l) => l.asset === leg.asset && l.cadenceSec === leg.cadenceSec)
      .flatMap((lane) => currentAndNext(lane, nowSec))
      .filter((w) => !used.has(w.id) && legOpen(w.expirySec, entryBufferSec, nowSec));
    const started = open.filter((w) => w.startSec <= nowSec).sort((a, b) => b.expirySec - a.expirySec);
    const pick = started[0] ?? open.sort((a, b) => a.startSec - b.startSec)[0];
    if (!pick) return leg;
    used.add(pick.id);
    const rolled = legOf(pick, leg.asset, leg.cadenceSec, leg.side);
    moved.push(rolled);
    return rolled;
  });
  return moved.length ? { legs: next, moved } : { legs, moved };
}

export function rollSlip(nowSec: number, entryBufferSec: number): SlipLeg[] {
  const r = rolledLegs(state.legs, nowSec, entryBufferSec);
  if (r.moved.length) commit({ ...state, legs: [...r.legs] });
  return r.moved;
}
