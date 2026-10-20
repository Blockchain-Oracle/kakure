"use client";

import {
  type BundleV2,
  cadenceLabel,
  currentAndNext,
  LANE_ASSETS,
  LANES,
  type LaneAsset,
  type LaneWindow,
  quoteWindow,
  type WindowPhase,
  type WindowQuote,
  type WindowState,
  windowPhase,
} from "@kakure/domain";
import { sharedPrices } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { useEffect, useMemo, useState } from "react";
import { COMMIT_MS } from "./constants";

/**
 * Which Window the terminal trades, and its live quote (Owarine `useTerminalWindow.ts`, `live.ts`).
 *
 * A lane is a Window length on one asset; the 2- and 5-minute lengths run two series offset in time, so a Window is
 * always mid-trade. The Window shown:
 * 1. the live one with the most time left (the newer series as soon as it's priced);
 * 2. else the one opening (its reference lands within seconds);
 * 3. else a riding Window you hold (watch it settle);
 * 4. else the next one, pre-listed and tradable at one half (Kakure trades pre-listed Windows; Owarine waits);
 * 5. else a riding Window nobody holds here.
 */
export interface TerminalLane {
  cadenceSec: number;
  label: string;
}

export interface ScreenWindow {
  window: LaneWindow;
  state: WindowState | null;
  phase: WindowPhase;
}

export function lanesFor(asset: LaneAsset): TerminalLane[] {
  const cadences = [...new Set(LANES.filter((l) => l.asset === asset).map((l) => l.cadenceSec))].sort((a, b) => a - b);
  return cadences.map((cadenceSec) => ({ cadenceSec, label: cadenceLabel(cadenceSec) }));
}

function candidates(asset: LaneAsset, cadenceSec: number, bundle: BundleV2 | null, nowSec: number): ScreenWindow[] {
  const states = new Map((bundle?.windows ?? []).map((w) => [w.id, w]));
  return LANES.filter((l) => l.asset === asset && l.cadenceSec === cadenceSec).flatMap((lane) =>
    currentAndNext(lane, nowSec).map((window) => {
      const state = states.get(window.id) ?? null;
      return { window, state, phase: windowPhase(window, state, nowSec) };
    }),
  );
}

export function pickWindow(
  asset: LaneAsset,
  cadenceSec: number,
  bundle: BundleV2 | null,
  nowSec: number,
  held: ReadonlySet<string>,
): ScreenWindow | null {
  const all = candidates(asset, cadenceSec, bundle, nowSec);
  const of = (phase: WindowPhase) => all.filter((c) => c.phase === phase);
  const byExpiry = (a: ScreenWindow, b: ScreenWindow) => a.window.expirySec - b.window.expirySec;
  const live = of("live").sort(byExpiry).at(-1);
  if (live) return live;
  const opening = of("opening").sort(byExpiry)[0];
  if (opening) return opening;
  const riding = of("riding").sort(byExpiry);
  const heldRiding = riding.find((c) => held.has(c.window.id));
  if (heldRiding) return heldRiding;
  const pre = of("pre").sort((a, b) => a.window.startSec - b.window.startSec)[0];
  return pre ?? riding[0] ?? null;
}

/** On a first visit: the shortest length with a live Window now, else the shortest. */
export function defaultCadence(asset: LaneAsset, bundle: BundleV2 | null, nowSec: number): number | null {
  const lanes = lanesFor(asset);
  for (const lane of lanes) {
    if (pickWindow(asset, lane.cadenceSec, bundle, nowSec, new Set())?.phase === "live") return lane.cadenceSec;
  }
  return lanes[0]?.cadenceSec ?? null;
}

/** Every lane asset's stream symbol: what the terminal values positions on. */
export const LANE_SYMBOLS: readonly StreamSymbol[] = LANE_ASSETS.map((asset) => `${asset}-USD` as const);

/**
 * Prices as numbers, one snapshot committed to React at most every 200 ms (leading edge, plus the last tick) whichever
 * of the symbols ticked. The chart reads the stream directly; this is what text and PnL re-render on.
 */
export function useCommittedSpots(symbols: readonly StreamSymbol[]): ReadonlyMap<StreamSymbol, number> {
  const key = symbols.join(",");
  const [prices, setPrices] = useState<ReadonlyMap<StreamSymbol, number>>(() => new Map());
  useEffect(() => {
    const list = key === "" ? [] : (key.split(",") as StreamSymbol[]);
    const stream = sharedPrices();
    stream?.start();
    let last = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const commit = () => {
      last = performance.now();
      const next = new Map<StreamSymbol, number>();
      for (const symbol of list) {
        const p = stream?.get(symbol)?.price;
        if (p) next.set(symbol, Number(p));
      }
      setPrices(next);
    };
    const tick = () => {
      const wait = last + COMMIT_MS - performance.now();
      if (wait <= 0) commit();
      else
        trailing ??= setTimeout(() => {
          trailing = null;
          commit();
        }, wait);
    };
    const offs = list.map((symbol) => stream?.subscribe(symbol, tick));
    commit();
    return () => {
      for (const off of offs) off?.();
      if (trailing) clearTimeout(trailing);
    };
  }, [key]);
  return prices;
}

/** One asset's committed price ("—" until its first tick). */
export function useCommittedSpot(symbol: StreamSymbol | null): number | null {
  const prices = useCommittedSpots(symbol ? [symbol] : []);
  return symbol ? (prices.get(symbol) ?? null) : null;
}

/** The Window's two sides now: the public formula on the live price, the signed reference and σ. */
export function useQuote(
  screen: ScreenWindow | null,
  spot: number | null,
  sigma: number | null,
  nowSec: number,
): WindowQuote | null {
  return useMemo(
    () => (screen ? quoteWindow(screen.window, screen.state, { spot, sigma }, nowSec) : null),
    [screen, spot, sigma, nowSec],
  );
}
