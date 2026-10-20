import {
  DECIMALS_BY_MAGNITUDE,
  EDGE_FADE_PX,
  MAX_DECIMALS,
  MAX_GRID_TICKS,
  MINOR_PER_MAJOR,
  NICE_CUTS,
  NICE_STEPS,
  SAMPLE_CAPACITY,
  SAMPLE_MS,
  SMALL_PRICE_SIGNIFICANT,
  STEP_FRACTION,
} from "./constants";

/**
 * The live chart's maths, ported from Owarine (`terminal/chart/engine.ts`, Tradash's model). Pure: no DOM, no React.
 *
 * The line is not time-based: every frame the eased price is pushed into a 600-sample ring, so the plot is the last
 * ~10 s of motion at the right edge, and the y-axis is re-centred on the eased price every frame at a fixed ±7.5 steps
 * (one step ≈ 0.01 % of price, frozen when the chart resets). Easing and sampling run on a 60 Hz clock whatever the
 * display's refresh rate.
 */

const DECADE = 10;
const HALF = 2;
const CATMULL_TENSION = 6;
const ROUND_GUARD = 1e-9;
const TICK_DIGITS = 10;

/** `k` per frame of `dtMs`, equivalent to `perSample` applied once per 60 Hz sample. */
export const easeFor = (perSample: number, dtMs: number): number =>
  1 - (1 - perSample) ** (Math.max(0, dtMs) / SAMPLE_MS);

/** Nice step: 1, 2, 5 or 10 × 10ⁿ. */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const pow = DECADE ** Math.floor(Math.log10(x));
  const m = x / pow;
  const [one, two, five] = NICE_CUTS;
  const [s1, s2, s5, s10] = NICE_STEPS;
  return (m < one ? s1 : m < two ? s2 : m < five ? s5 : s10) * pow;
}

/** The frozen grid step for a price (0.01 % of it, made nice). */
export const stepFor = (price: number): number => niceStep(STEP_FRACTION * Math.abs(price));

/** Display decimals by magnitude; tiny prices get enough to show three significant digits. */
export function priceDecimals(price: number): number {
  const a = Math.abs(price);
  for (const [floor, decimals] of DECIMALS_BY_MAGNITUDE) if (a >= floor) return decimals;
  if (a === 0) return 2;
  return Math.min(MAX_DECIMALS, SMALL_PRICE_SIGNIFICANT - Math.floor(Math.log10(a)));
}

/** A grid label's decimals: the price's, or more when the step is finer. */
export function labelDecimals(price: number, step: number): number {
  return Math.max(priceDecimals(price), Math.max(0, -Math.floor(Math.log10(step) + ROUND_GUARD)));
}

/** One formatter per decimal count (a cached `Intl.NumberFormat` is ~40× cheaper than `toLocaleString` per call). */
const formatters = new Map<number, Intl.NumberFormat>();
function formatterFor(decimals: number): Intl.NumberFormat {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f;
}

export function formatPrice(price: number, decimals = priceDecimals(price)): string {
  return formatterFor(decimals).format(price);
}

export const formatUsd = (price: number, decimals?: number): string => `$${formatPrice(price, decimals)}`;

/** Signed with a true minus: "+1.2345" / "−0.0320". */
export function formatSigned(value: number, decimals = 2): string {
  const sign = value < 0 ? "−" : "+";
  return `${sign}${formatterFor(decimals).format(Math.abs(value))}`;
}

/** A ring of the last `capacity` samples, oldest first when read. */
export class SampleRing {
  readonly capacity: number;
  private buf: Float64Array;
  private start = 0;
  private size = 0;

  constructor(capacity = SAMPLE_CAPACITY) {
    this.capacity = capacity;
    this.buf = new Float64Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(v: number): void {
    if (this.size < this.capacity) {
      this.buf[(this.start + this.size) % this.capacity] = v;
      this.size += 1;
    } else {
      this.buf[this.start] = v;
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** Fills the ring with one value (the first price: the chart starts flat and grows movement from the right). */
  fill(v: number): void {
    this.buf.fill(v);
    this.start = 0;
    this.size = this.capacity;
  }

  at(i: number): number {
    return this.buf[(this.start + i) % this.capacity] ?? 0;
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }
}

/** The plot's vertical window: centred on `center`, `half` either side, inside `[top, bottom]` CSS px. */
export interface YWindow {
  center: number;
  half: number;
  top: number;
  bottom: number;
}

export const yOf = (price: number, w: YWindow): number => {
  const mid = (w.top + w.bottom) / HALF;
  return mid - ((price - w.center) / w.half) * ((w.bottom - w.top) / HALF);
};

/** The price at a y, the inverse of `yOf`. */
export const priceAtY = (y: number, w: YWindow): number =>
  w.center + (((w.top + w.bottom) / HALF - y) / ((w.bottom - w.top) / HALF)) * w.half;

/**
 * Uniform Catmull-Rom → cubic Bézier control points (tension 1/6, endpoints duplicated) for segment i→i+1, as
 * `[c1x, c1y, c2x, c2y]`.
 */
export function catmullRom(xs: ArrayLike<number>, ys: ArrayLike<number>, i: number): [number, number, number, number] {
  const n = xs.length;
  const at = (arr: ArrayLike<number>, k: number) => arr[k] ?? 0;
  const a = Math.max(0, i - 1);
  const d = Math.min(n - 1, i + 2);
  const b = i;
  const c = i + 1;
  return [
    at(xs, b) + (at(xs, c) - at(xs, a)) / CATMULL_TENSION,
    at(ys, b) + (at(ys, c) - at(ys, a)) / CATMULL_TENSION,
    at(xs, c) - (at(xs, d) - at(xs, b)) / CATMULL_TENSION,
    at(ys, c) - (at(ys, d) - at(ys, b)) / CATMULL_TENSION,
  ];
}

/** Grid ticks: a minor every step / 5, a major every step, across `[lo, hi]`; none past 400 ticks. */
export function gridTicks(lo: number, hi: number, step: number): Array<{ value: number; major: boolean }> {
  const minor = step / MINOR_PER_MAJOR;
  if (!(minor > 0) || (hi - lo) / minor > MAX_GRID_TICKS) return [];
  const out: Array<{ value: number; major: boolean }> = [];
  const first = Math.ceil(lo / minor);
  for (let k = first; k * minor <= hi + ROUND_GUARD * Math.abs(hi); k++) {
    out.push({ value: Number((k * minor).toFixed(TICK_DIGITS)), major: k % MINOR_PER_MAJOR === 0 });
  }
  return out;
}

/**
 * One rolling digit slot of the canvas odometer. A change moves `target` by the mod-10 distance, forward on a rise and
 * backward on a fall (9 → 0 on a rise rolls up through 0), and `cur` eases to it.
 */
export function rollTarget(cur: number, digitNow: number, digitNext: number, direction: 1 | -1 | 0): number {
  const fwd = (digitNext - digitNow + DECADE) % DECADE;
  const back = fwd === 0 ? 0 : fwd - DECADE;
  const delta = direction > 0 ? fwd : direction < 0 ? back : Math.abs(back) < fwd ? back : fwd;
  return cur + delta;
}

/** The digit shown at a fractional roll position, the next one, and how far between them (0..1). */
export function rollFrame(cur: number): { digit: number; next: number; frac: number } {
  const base = Math.floor(cur);
  return {
    digit: ((base % DECADE) + DECADE) % DECADE,
    next: (((base + 1) % DECADE) + DECADE) % DECADE,
    frac: cur - base,
  };
}

/** Alpha for a label near a plot edge or the pill: fades over 14 px. */
export const edgeAlpha = (distancePx: number): number => Math.min(1, Math.max(0, distancePx / EDGE_FADE_PX));
