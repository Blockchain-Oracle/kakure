import { type BundleV2, cadenceLabel, LANE_ASSETS, LANES, type LaneAsset } from "@kakure/domain";
import { pickWindow, type ScreenWindow } from "@/features/terminal/use-window";

/**
 * The real-time lanes as the Markets page shows them (plan §00 Markets): one lane per Window length, each asset's
 * Window on it picked the way the terminal picks it, and the hero: the shortest Window open now, never a daily one.
 */
const DAY_SEC = 86_400;

/** Every Window length any asset trades, shortest first. */
export const LENGTHS: readonly number[] = [...new Set(LANES.map((l) => l.cadenceSec))].sort((a, b) => a - b);

export interface LaneCard {
  asset: LaneAsset;
  cadenceSec: number;
  screen: ScreenWindow | null;
}

/** Each asset's Window on one length, in the lane order (BTC first). */
export function laneCards(cadenceSec: number, bundle: BundleV2 | null, nowSec: number): LaneCard[] {
  return LANE_ASSETS.filter((asset) => LANES.some((l) => l.asset === asset && l.cadenceSec === cadenceSec)).map(
    (asset) => ({ asset, cadenceSec, screen: pickWindow(asset, cadenceSec, bundle, nowSec, new Set()) }),
  );
}

/** How many of a length's Windows trade right now (the lane tab's count). */
export const liveCount = (cadenceSec: number, bundle: BundleV2 | null, nowSec: number): number =>
  laneCards(cadenceSec, bundle, nowSec).filter((c) => c.screen?.phase === "live").length;

/** The hero: the shortest length with a live Window, never a daily one; its first asset trading now. */
export function heroPick(bundle: BundleV2 | null, nowSec: number): { asset: LaneAsset; cadenceSec: number } | null {
  for (const cadenceSec of LENGTHS) {
    if (cadenceSec >= DAY_SEC) break;
    const live = laneCards(cadenceSec, bundle, nowSec).find((c) => c.screen?.phase === "live");
    if (live) return { asset: live.asset, cadenceSec };
  }
  const first = LENGTHS[0];
  return first === undefined ? null : { asset: LANE_ASSETS[0], cadenceSec: first };
}

/** The terminal on one asset and length (the fragment never reaches the host). */
export const tradeHref = (asset: LaneAsset, cadenceSec: number): string =>
  `/trade#${asset}/${cadenceLabel(cadenceSec)}`;
