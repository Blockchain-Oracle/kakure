import {
  CANDLE_INTERVAL_MS,
  CANDLES_PATH,
  type CandleInterval,
  type CandlesResponse,
  type StreamSymbol,
} from "@kakure/feeds/protocol";
import {
  bodyWidth,
  type Candle,
  CandleSeries,
  candleStep,
  defaultSpacing,
  detent,
  slotX,
  visibleRange,
} from "./candles";
import {
  AXIS_DRAG_RATE,
  CANDLE_HALF_STEPS,
  CANDLE_INITIAL,
  CANDLE_OLDER_WITHIN,
  CANDLE_REFRESH_AFTER_MS,
  CANDLE_REFRESH_COUNT,
  CANDLE_RETRY_MS,
  CROSSHAIR_ALPHA,
  CROSSHAIR_DASH,
  CROSSHAIR_OVERHANG,
  CROSSHAIR_PILL_H,
  CROSSHAIR_PILL_PAD,
  CROSSHAIR_PILL_RIGHT,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  HEAD_RADIUS,
  OFF_CENTRE_OFFSET,
  PAN_KEEP_OLDEST,
  PAN_PAST_NEWEST,
  RECENTRE_DONE_HALF,
  RECENTRE_DONE_OFFSET,
  RECENTRE_EASE,
  SPACING_MAX,
  SPACING_MIN,
  SPAN_STEPS,
  STEP_FRACTION,
  TAP_MS,
  TAP_PX,
  WHEEL_PINCH_RATE,
  WHEEL_SCALE_RATE,
  WHEEL_ZOOM_RATE,
} from "./constants";
import { formatPrice, niceStep, priceAtY, type YWindow, yOf } from "./engine";
import type { ChartTheme } from "./style";

/**
 * The candle view (Owarine `chart/candle-view.ts`, Tradash's `CandleSeries` + `CandleViewport` + `CandleGestures`):
 * 300 candles from the relay, the last three re-read at each boundary + 4 s, older history fetched as the view nears
 * it, a full reload when the tab returns; pan, pinch, wheel, axis-drag y-scale, a tap crosshair snapping to candle ×
 * step/5 detents (with a haptic tick), double-tap to recentre. Drawn in four batched paths.
 *
 * Kakure's relay answers every traded asset in one response (PD19); this view keeps its own symbol's rows.
 */
export interface CandleGeometry {
  plotW: number;
  win: YWindow | null;
}

const HALF = 2;
const PIXEL = 0.5;

export class CandleView {
  readonly series: CandleSeries;
  spacing: number | null = null;
  offset = 0;
  free: { center: number; half: number } | null = null;
  crosshair: { x: number; y: number } | null = null;
  unavailable: string | null = null;
  private step: number | null = null;
  private recentering = false;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private olderAsked = new Set<number>();
  private stopped = false;
  private lastDetent = "";

  constructor(
    private symbol: StreamSymbol,
    readonly interval: CandleInterval,
    private base: string,
    private onDetent: () => void,
  ) {
    this.series = new CandleSeries(CANDLE_INTERVAL_MS[interval]);
  }

  start(): () => void {
    void this.load(CANDLE_INITIAL);
    const onVisible = () => {
      if (document.visibilityState === "visible") void this.load(CANDLE_INITIAL);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      this.stopped = true;
      for (const timer of this.timers) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  private async fetchRows(count: number, endMs?: number): Promise<Candle[]> {
    const end = endMs === undefined ? "" : `&end=${endMs}`;
    const response = await fetch(`${this.base}${CANDLES_PATH}?interval=${this.interval}&count=${count}${end}`);
    if (!response.ok) throw new Error(`candles HTTP ${response.status}`);
    const body = (await response.json()) as CandlesResponse;
    const rows = body.candles[this.symbol];
    if (!rows) {
      this.unavailable = `Candles for ${this.symbol.replace("-USD", "")} aren't available right now`;
      return [];
    }
    this.unavailable = null;
    return rows.map(([t, o, h, l, c]) => ({ t, o: Number(o), h: Number(h), l: Number(l), c: Number(c) }));
  }

  private async load(count: number): Promise<void> {
    try {
      const rows = await this.fetchRows(count);
      if (this.stopped) return;
      this.series.merge(rows, Date.now());
      this.arm();
    } catch {
      if (!this.stopped) this.timers.push(setTimeout(() => void this.load(count), CANDLE_RETRY_MS));
    }
  }

  /** The next refresh: at the next boundary + 4 s, the last three candles. */
  private arm(): void {
    const ms = CANDLE_INTERVAL_MS[this.interval];
    const wait = Math.ceil(Date.now() / ms) * ms + CANDLE_REFRESH_AFTER_MS - Date.now();
    this.timers.push(setTimeout(() => void this.load(CANDLE_REFRESH_COUNT), wait));
  }

  private async older(): Promise<void> {
    const oldest = this.series.oldestT;
    if (oldest === null || this.olderAsked.has(oldest)) return;
    this.olderAsked.add(oldest);
    try {
      const rows = await this.fetchRows(CANDLE_INITIAL, oldest);
      if (!this.stopped) this.series.merge(rows, Date.now());
    } catch {
      this.olderAsked.delete(oldest);
    }
  }

  /** The visible y window: centred on the live price at ±7.5 auto steps, or the free window after a pan or axis drag. */
  window(plotW: number, top: number, bottom: number, price: number): { win: YWindow; step: number } {
    const spacing = this.spacing ?? defaultSpacing(plotW);
    if (this.step === null || this.series.closed.length < HALF) {
      const { from, to } = visibleRange(plotW, spacing, this.offset);
      const bodies: Candle[] = [];
      for (let k = from; k <= to; k++) {
        const c = this.series.at(k);
        if (c) bodies.push(c);
      }
      this.step = bodies.length ? candleStep(bodies, price, niceStep) : niceStep(STEP_FRACTION * price);
    }
    const auto = { center: price, half: CANDLE_HALF_STEPS * this.step };
    if (this.recentering) {
      this.offset += (0 - this.offset) * RECENTRE_EASE;
      if (this.free) {
        this.free = {
          center: this.free.center + (auto.center - this.free.center) * RECENTRE_EASE,
          half: this.free.half + (auto.half - this.free.half) * RECENTRE_EASE,
        };
        const near = auto.half * RECENTRE_DONE_HALF;
        if (Math.abs(this.free.half - auto.half) < near && Math.abs(this.free.center - auto.center) < near) {
          this.free = null;
        }
      }
      if (Math.abs(this.offset) < RECENTRE_DONE_OFFSET && !this.free) {
        this.offset = 0;
        this.recentering = false;
      }
    }
    const y = this.free ?? auto;
    return { win: { center: y.center, half: y.half, top, bottom }, step: niceStep((HALF * y.half) / SPAN_STEPS) };
  }

  get offCentre(): boolean {
    return Math.abs(this.offset) > OFF_CENTRE_OFFSET || this.free !== null;
  }

  recentre(): void {
    this.recentering = true;
    this.crosshair = null;
  }

  /** Bodies and wicks, batched by direction; the forming candle slides in after a rollover. */
  draw(ctx: CanvasRenderingContext2D, theme: ChartTheme, win: YWindow, plotW: number): void {
    const spacing = this.spacing ?? defaultSpacing(plotW);
    const { from, to } = visibleRange(plotW, spacing, this.offset);
    if (to >= this.series.count - CANDLE_OLDER_WITHIN) void this.older();
    const bw = bodyWidth(spacing);
    const upBody = new Path2D();
    const downBody = new Path2D();
    const upWick = new Path2D();
    const downWick = new Path2D();
    for (let k = from; k <= to; k++) {
      const c = this.series.at(k);
      if (!c) continue;
      const x = slotX(k, plotW, spacing, this.offset, this.series.slide);
      if (x < -spacing || x > plotW + spacing) continue;
      const up = c.c >= c.o;
      const yo = yOf(c.o, win);
      const yc = yOf(c.c, win);
      const xr = Math.round(x) + PIXEL;
      const wick = up ? upWick : downWick;
      wick.moveTo(xr, yOf(c.h, win));
      wick.lineTo(xr, yOf(c.l, win));
      (up ? upBody : downBody).rect(Math.round(x - bw / HALF), Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, ctx.canvas.height);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.up;
    ctx.stroke(upWick);
    ctx.strokeStyle = theme.down;
    ctx.stroke(downWick);
    ctx.fillStyle = theme.up;
    ctx.fill(upBody);
    ctx.fillStyle = theme.down;
    ctx.fill(downBody);
    ctx.restore();
    this.series.decay();
  }

  /** The crosshair: dashed lines, a dot, and the price capsule at the axis. */
  drawCrosshair(
    ctx: CanvasRenderingContext2D,
    theme: ChartTheme,
    win: YWindow,
    step: number,
    plotW: number,
    w: number,
  ): void {
    if (!this.crosshair) return;
    const spacing = this.spacing ?? defaultSpacing(plotW);
    const geometry = { plotW, spacing, offset: this.offset, slide: this.series.slide };
    const d = detent(this.crosshair.x, this.crosshair.y, geometry, (y) => priceAtY(y, win), step);
    const key = `${d.k}:${d.price}`;
    if (key !== this.lastDetent) {
      if (this.lastDetent) this.onDetent();
      this.lastDetent = key;
    }
    const x = slotX(d.k, plotW, spacing, this.offset, this.series.slide);
    const y = yOf(d.price, win);
    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = CROSSHAIR_ALPHA;
    ctx.setLineDash([...CROSSHAIR_DASH]);
    ctx.beginPath();
    ctx.moveTo(x, win.top - CROSSHAIR_OVERHANG);
    ctx.lineTo(x, win.bottom + CROSSHAIR_OVERHANG);
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(x, y, HEAD_RADIUS, 0, Math.PI * HALF);
    ctx.fill();
    const text = `$${formatPrice(d.price)}`;
    ctx.font = theme.pillPriceFont;
    const tw = ctx.measureText(text).width + CROSSHAIR_PILL_PAD * HALF;
    ctx.beginPath();
    ctx.roundRect(
      w - CROSSHAIR_PILL_RIGHT - tw,
      y - CROSSHAIR_PILL_H / HALF,
      tw,
      CROSSHAIR_PILL_H,
      CROSSHAIR_PILL_H / HALF,
    );
    ctx.fill();
    ctx.fillStyle = theme.inverse;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w - CROSSHAIR_PILL_RIGHT - tw + CROSSHAIR_PILL_PAD, y + PIXEL);
  }

  /** Pointer and wheel gestures on the canvas; `geom` reads the current plot. Returns the detach. */
  attach(canvas: HTMLCanvasElement, geom: () => CandleGeometry): () => void {
    const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; at: number }>();
    let pinch: { dist: number; spacing: number } | null = null;
    let lastTap = { at: 0, x: 0, y: 0 };
    let axisDrag = false;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const spacingOf = (plotW: number) => this.spacing ?? defaultSpacing(plotW);
    const freeFrom = (win: YWindow | null) => this.free ?? (win ? { center: win.center, half: win.half } : null);
    const clampOffset = (plotW: number) => {
      const slots = plotW / spacingOf(plotW);
      this.offset = Math.min(
        Math.max(this.offset, -PAN_PAST_NEWEST * slots),
        Math.max(0, this.series.count - PAN_KEEP_OLDEST),
      );
    };
    const pair = () => [...pointers.values()];
    const distance = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
      a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;

    const down = (e: PointerEvent) => {
      const p = local(e);
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { ...p, startX: p.x, startY: p.y, at: performance.now() });
      axisDrag = pointers.size === 1 && p.x > geom().plotW;
      if (pointers.size === HALF) {
        const [a, b] = pair();
        pinch = { dist: distance(a, b), spacing: spacingOf(geom().plotW) };
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (this.crosshair && e.pointerType === "mouse") this.crosshair = local(e);
        return;
      }
      const p = local(e);
      const { plotW, win } = geom();
      if (pointers.size === HALF && pinch) {
        pointers.set(e.pointerId, { ...prev, ...p });
        const [a, b] = pair();
        this.spacing = Math.min(
          SPACING_MAX,
          Math.max(SPACING_MIN, pinch.spacing * (distance(a, b) / (pinch.dist || 1))),
        );
        return;
      }
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      pointers.set(e.pointerId, { ...prev, ...p });
      this.recentering = false;
      if (axisDrag) {
        const f = freeFrom(win);
        if (f) this.free = { center: f.center, half: f.half * Math.exp(AXIS_DRAG_RATE * dy) };
        return;
      }
      if (this.crosshair) {
        this.crosshair = p;
        return;
      }
      this.offset += dx / spacingOf(plotW);
      clampOffset(plotW);
      const f = freeFrom(win);
      if (dy !== 0 && win && f) {
        this.free = { center: f.center + (dy / ((win.bottom - win.top) / HALF)) * f.half, half: f.half };
      }
    };
    const up = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < HALF) pinch = null;
      if (!prev) return;
      const p = local(e);
      const quick = performance.now() - prev.at < TAP_MS && Math.hypot(p.x - prev.startX, p.y - prev.startY) < TAP_PX;
      if (!quick) return;
      const now = performance.now();
      if (now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_PX) {
        this.recentre();
        lastTap = { at: 0, x: 0, y: 0 };
        return;
      }
      lastTap = { at: now, ...p };
      this.crosshair = this.crosshair ? null : p;
      this.lastDetent = "";
      this.onDetent();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { plotW, win } = geom();
      const p = local(e);
      this.recentering = false;
      if (p.x > plotW) {
        const f = freeFrom(win);
        if (f) this.free = { center: f.center, half: f.half * Math.exp(WHEEL_SCALE_RATE * e.deltaY) };
        return;
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.offset -= e.deltaX / spacingOf(plotW);
        clampOffset(plotW);
        return;
      }
      const rate = e.ctrlKey ? WHEEL_PINCH_RATE : WHEEL_ZOOM_RATE;
      this.spacing = Math.min(SPACING_MAX, Math.max(SPACING_MIN, spacingOf(plotW) * Math.exp(-e.deltaY * rate)));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }
}
