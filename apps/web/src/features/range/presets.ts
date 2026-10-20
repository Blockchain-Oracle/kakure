/**
 * Range's band presets (Owarine `range/presets.ts`, from the reference's `ticket624.core.ts`): Tight, Balanced and Wide
 * are ±$15 / $30 / $55 on BTC at the reference's $77k and its 5-minute Window. Other lengths scale by √time from that
 * anchor (a ±$30 band is trivial over a minute and a real call over an hour), and other assets by their price ratio to
 * it, snapped to the nearest "nice" grid step, so ETH gets cents where BTC gets dollars.
 */
import { formatUsd } from "@kakure/chart";
import { NICE_UNITS, RANGE_PRESETS } from "./constants";

export { RANGE_PRESETS };
export type RangePresetKey = (typeof RANGE_PRESETS)[number]["key"];

/** How far the band's centre may sit from the price, in the reference's dollars, before scaling. */
const CENTER_MAX = 35;
/** The reference's centre step: five dollars, on BTC. */
const STEP_USD = 5;
/** The price the reference's dollar presets were tuned at (BTC while it was written). */
const ANCHOR_USD = 77_000;
const ANCHOR_SEC = 300;
const MINUTE_SEC = 60;
const HOUR_SEC = 3_600;
const SUB_MINUTE_FACTOR = 0.5;
const HOUR_FACTOR = 4;
const MAX_FACTOR = 16;
const FACTOR_DP = 10;
/** The track shows at least this many grid steps either side of the price. */
const TRACK_MIN_STEPS = 18;
const UNIT_DECIMALS = 5;

export function lengthFactor(cadenceSec: number): number {
  if (cadenceSec <= MINUTE_SEC) return SUB_MINUTE_FACTOR;
  if (cadenceSec <= ANCHOR_SEC) return 1;
  if (cadenceSec === HOUR_SEC) return HOUR_FACTOR;
  return Math.min(MAX_FACTOR, Math.round(Math.sqrt(cadenceSec / ANCHOR_SEC) * FACTOR_DP) / FACTOR_DP);
}

const assetScale = (spot: number) => (spot > 0 ? spot / ANCHOR_USD : 1);

/** The centre grid for this asset: the reference's $5 scaled by price, then the nearest nice step (log distance). */
export function bandUnit(spot: number): number {
  const raw = STEP_USD * assetScale(spot);
  let best: number = NICE_UNITS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const unit of NICE_UNITS) {
    const distance = Math.abs(Math.log(raw / unit));
    if (distance < bestDistance) {
      best = unit;
      bestDistance = distance;
    }
  }
  return best;
}

function roundToUnit(value: number, unit: number, minUnits: number): number {
  const units = Math.max(minUnits, Math.round(value / unit));
  return Number((units * unit).toFixed(UNIT_DECIMALS));
}

/** The preset's half-width in dollars for this length and asset, on the grid, never under one step. */
export function bandHalf(preset: RangePresetKey, cadenceSec: number, spot: number): number {
  const half = RANGE_PRESETS.find((p) => p.key === preset)?.half ?? RANGE_PRESETS[1].half;
  return roundToUnit(half * lengthFactor(cadenceSec) * assetScale(spot), bandUnit(spot), 1);
}

/** How far the centre may move from the price, on the grid. */
export function centerMax(cadenceSec: number, spot: number): number {
  return roundToUnit(CENTER_MAX * lengthFactor(cadenceSec) * assetScale(spot), bandUnit(spot), 2);
}

/** The track around the price: ±max(18 steps, half + the centre's reach). */
export function trackHalf(half: number, reach: number, unit: number): number {
  return Math.max(TRACK_MIN_STEPS * unit, half + reach);
}

/** A centre offset on the grid, within ±max. */
export function snapOffset(value: number, max: number, unit: number): number {
  const magnitude = Math.min(max, roundToUnit(Math.abs(value), unit, 0));
  return Number(((value < 0 ? -1 : 1) * magnitude).toFixed(UNIT_DECIMALS));
}

/** The decimals a figure on this grid needs: none on BTC's $5, cents on ETH's $0.20. */
export const unitPlaces = (unit: number): number => Math.max(0, -Math.floor(Math.log10(unit) + Number.EPSILON));

/** A price on the grid, as the decimal string the mint receives. */
export function edgeText(price: number, unit: number): string {
  return (Math.round(price / unit) * unit).toFixed(unitPlaces(unit));
}

/** A dollar figure on the grid: "$81,400", "$110", "$2.40". */
export const gridUsd = (value: number, unit: number): string => formatUsd(value, unitPlaces(unit));
