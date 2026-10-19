import { CADENCES_SEC, ENTRY_BUFFER_SEC, LANE_ASSETS, type LaneAsset, PHASES_SEC } from "./constants";

/**
 * Real-time lanes (plan §00 REVAMP 2): Windows run back to back per (asset, cadence, phase), like Owarine's crypto lanes
 * (`packages/core/src/market/crypto.ts:20-27`) and Mitoshi's (`windows.ts:17`). A Window is derived from its lane and
 * its start, so nothing but the lane rules needs publishing ahead. The Rust operator mirrors this file
 * (`services/operator/src/lanes.rs`); `fixtures/lanes.json` keeps the two identical.
 */

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

export interface Lane {
  /** `btc-1m`, `btc-2m`, `btc-2m+1` (the series one minute later), `eth-1d`. */
  id: string;
  asset: LaneAsset;
  cadenceSec: number;
  phaseSec: number;
}

export interface LaneWindow {
  /** `<lane id>-<start unix seconds>`, e.g. `btc-5m+3-1792400280`. */
  id: string;
  lane: string;
  startSec: number;
  expirySec: number;
}

export const WINDOW_ID_PATTERN = /^[a-z]{3,4}-\d{1,2}[mhd](?:\+\d{1,2})?-\d{10}$/;

/** "1m", "2m", "5m", "15m", "1h", "4h", "1d". */
export function cadenceLabel(cadenceSec: number): string {
  if (cadenceSec % DAY === 0) return `${cadenceSec / DAY}d`;
  if (cadenceSec % HOUR === 0) return `${cadenceSec / HOUR}h`;
  return `${cadenceSec / MINUTE}m`;
}

export function laneId(asset: LaneAsset, cadenceSec: number, phaseSec: number): string {
  const base = `${asset.toLowerCase()}-${cadenceLabel(cadenceSec)}`;
  return phaseSec === 0 ? base : `${base}+${phaseSec / MINUTE}`;
}

/** Every lane, by asset then cadence then phase. */
export const LANES: readonly Lane[] = LANE_ASSETS.flatMap((asset) =>
  CADENCES_SEC.flatMap((cadenceSec) =>
    (PHASES_SEC[cadenceSec] ?? [0]).map((phaseSec) => ({
      id: laneId(asset, cadenceSec, phaseSec),
      asset,
      cadenceSec,
      phaseSec,
    })),
  ),
);

const LANE_BY_ID = new Map(LANES.map((lane) => [lane.id, lane]));

export function laneById(id: string): Lane | undefined {
  return LANE_BY_ID.get(id);
}

/** The start of the lane's Window containing `atSec` (a start is `phase + k · cadence`). */
export function windowStartAt(lane: Lane, atSec: number): number {
  return lane.phaseSec + Math.floor((atSec - lane.phaseSec) / lane.cadenceSec) * lane.cadenceSec;
}

export function laneWindow(lane: Lane, startSec: number): LaneWindow {
  return { id: `${lane.id}-${startSec}`, lane: lane.id, startSec, expirySec: startSec + lane.cadenceSec };
}

/** The Window trading at `atSec` on this lane, and the one after it (pre-listed). */
export function currentAndNext(lane: Lane, atSec: number): [LaneWindow, LaneWindow] {
  const start = windowStartAt(lane, atSec);
  return [laneWindow(lane, start), laneWindow(lane, start + lane.cadenceSec)];
}

export function parseWindowId(id: string): { lane: Lane; window: LaneWindow } | null {
  if (!WINDOW_ID_PATTERN.test(id)) return null;
  const cut = id.lastIndexOf("-");
  const lane = laneById(id.slice(0, cut));
  const startSec = Number(id.slice(cut + 1));
  if (!lane || (startSec - lane.phaseSec) % lane.cadenceSec !== 0) return null;
  return { lane, window: laneWindow(lane, startSec) };
}

/** Entry and early close end here; after it, positions ride to settlement. */
export function entryCutoffSec(window: LaneWindow): number {
  return window.expirySec - ENTRY_BUFFER_SEC;
}
