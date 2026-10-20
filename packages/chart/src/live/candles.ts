import {
  BODY_SHARE,
  CANDLE_CAP,
  CANDLE_DEV_FACTOR,
  CANDLE_MIN_SPAN_FRACTION,
  MINOR_PER_MAJOR,
  SLIDE_DECAY,
  SLIDE_DONE,
  SLOT_OVERSCAN,
  SPACING_DEFAULT_DIVISOR,
  SPACING_DEFAULT_MAX,
  SPACING_DEFAULT_MIN,
  SPAN_STEPS,
} from "./constants";

/**
 * The candle view's maths (Owarine `chart/candles.ts`, Tradash's `CandleSeries` and `CandleViewport`): closed history
 * from the relay's `/v1/candles` plus the forming candle built from live ticks (its high and low follow the raw ticks,
 * its close the eased price), rolling over at each bucket with a one-slot slide-in that decays ×0.86 a frame. Pure.
 */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

const HALF_SLOT = 0.5;
const MIN_SLOTS_BEHIND = 1;

export const defaultSpacing = (plotW: number): number =>
  Math.min(SPACING_DEFAULT_MAX, Math.max(SPACING_DEFAULT_MIN, plotW / SPACING_DEFAULT_DIVISOR));
export const bodyWidth = (spacing: number): number => Math.max(1, Math.round(BODY_SHARE * spacing));

export class CandleSeries {
  closed: Candle[] = [];
  forming: Candle | null = null;
  /** 1 right after a rollover, decaying to 0: the newest candle slides in from the right. */
  slide = 0;

  constructor(readonly intervalMs: number) {}

  /** Merges fetched candles (any order, overlapping allowed); the bucket still forming stays live. */
  merge(rows: readonly Candle[], nowMs: number): void {
    const current = Math.floor(nowMs / this.intervalMs) * this.intervalMs;
    const byT = new Map(this.closed.map((c) => [c.t, c]));
    for (const r of rows) {
      if (r.t >= current) {
        if (!this.forming || this.forming.t === r.t) {
          this.forming = this.forming
            ? { ...r, h: Math.max(r.h, this.forming.h), l: Math.min(r.l, this.forming.l), c: this.forming.c }
            : { ...r };
        }
        continue;
      }
      byT.set(r.t, { ...r });
    }
    this.closed = [...byT.values()].sort((a, b) => a.t - b.t).slice(-CANDLE_CAP);
  }

  /** A live tick: `raw` moves the high and low, `eased` is the close the eye follows. */
  update(raw: number, eased: number, nowMs: number): void {
    const bucket = Math.floor(nowMs / this.intervalMs) * this.intervalMs;
    if (!this.forming || bucket > this.forming.t) {
      if (this.forming) {
        this.closed.push(this.forming);
        if (this.closed.length > CANDLE_CAP) this.closed.shift();
        this.slide = 1;
      }
      const open = this.forming?.c ?? eased;
      this.forming = { t: bucket, o: open, h: Math.max(open, raw), l: Math.min(open, raw), c: eased };
      return;
    }
    this.forming.h = Math.max(this.forming.h, raw);
    this.forming.l = Math.min(this.forming.l, raw);
    this.forming.c = eased;
  }

  decay(k = SLIDE_DECAY): void {
    this.slide = this.slide < SLIDE_DONE ? 0 : this.slide * k;
  }

  /** The k-th candle from the newest (0 = forming). */
  at(k: number): Candle | null {
    if (k === 0) return this.forming;
    return this.closed[this.closed.length - k] ?? null;
  }

  get count(): number {
    return this.closed.length + (this.forming ? 1 : 0);
  }

  get oldestT(): number | null {
    return this.closed[0]?.t ?? this.forming?.t ?? null;
  }
}

/** Slot x of the k-th newest candle. */
export const slotX = (k: number, plotW: number, spacing: number, offset: number, slide: number): number =>
  plotW - spacing * (HALF_SLOT + k - offset) + slide * spacing;

/** Which k range is on screen. */
export function visibleRange(plotW: number, spacing: number, offset: number): { from: number; to: number } {
  const slots = Math.ceil(plotW / spacing) + SLOT_OVERSCAN;
  return { from: Math.max(0, Math.floor(offset) - MIN_SLOTS_BEHIND), to: Math.floor(offset) + slots };
}

/** Auto y-step from the visible bodies: nice(max(2·dev·1.15, 0.15 % of price) / 15). */
export function candleStep(
  bodies: ReadonlyArray<{ o: number; c: number }>,
  price: number,
  nice: (x: number) => number,
): number {
  let dev = 0;
  for (const b of bodies) dev = Math.max(dev, Math.abs(b.o - price), Math.abs(b.c - price));
  return nice(Math.max(CANDLE_DEV_FACTOR * dev, CANDLE_MIN_SPAN_FRACTION * price) / SPAN_STEPS);
}

/** The crosshair's snap point: a candle slot and a price bucket of step / 5. */
export function detent(
  x: number,
  y: number,
  geometry: { plotW: number; spacing: number; offset: number; slide: number },
  priceAt: (y: number) => number,
  step: number,
): { k: number; price: number } {
  const { plotW, spacing, offset, slide } = geometry;
  const k = Math.max(0, Math.round((plotW + slide * spacing - x) / spacing - HALF_SLOT + offset));
  const bucket = step / MINOR_PER_MAJOR;
  return { k, price: Math.round(priceAt(y) / bucket) * bucket };
}
