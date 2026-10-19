import {
  AXIS_FONT_PX,
  AXIS_WIDTH,
  FILL_ALPHA,
  FUTURE_ALPHA,
  GRID_ALPHA,
  GRID_LINES,
  HEAD_RADIUS,
  LABEL_GAP,
  LEAD_FRACTION,
  LEAD_MAX_MS,
  LEAD_MIN_MS,
  LINE_WIDTH,
  MAX_POINTS,
  MIN_SPAN_FRACTION,
  PAD_BOTTOM,
  PAD_LEFT,
  PAD_TOP,
  PILL_FONT_PX,
  PILL_HEIGHT,
  PILL_PAD_X,
  PILL_RADIUS,
  PULSE_ALPHA,
  PULSE_PERIOD_MS,
  PULSE_RADIUS,
  RANGE_EASE,
  RANGE_PAD,
  REFERENCE_DASH,
  ROLL_MS,
  THEME_POLL_MS,
} from "./constants";
import { type Colors, drawDots, drawWatermark, formatPrice } from "./layers";

/** The market window the chart frames, and the line every close is judged against. */
export interface WindowSpec {
  opensAt: number;
  closesAt: number;
  /** The opening print (or a strike); `null` until it is fixed. */
  reference: number | null;
  /** Shown on the reference line, e.g. "Open" or "Strike". */
  referenceLabel: string;
}

interface Roll {
  from: string;
  to: string;
  started: number;
}

const TAU = Math.PI * 2;
const HALF = 0.5;

/**
 * A live Window chart on a canvas, drawn every animation frame from data held outside React: history points plus
 * live ticks pushed straight from the price stream. Colours come from the page's design tokens (`--up`, `--down`,
 * `--accent`, …) and are re-read when the theme or network changes.
 */
export class WindowChart {
  private readonly ctx: CanvasRenderingContext2D;
  private points: Array<[number, number]> = [];
  private spec: WindowSpec | null = null;
  private colors: Colors | null = null;
  private yMin = Number.NaN;
  private yMax = Number.NaN;
  private width = 0;
  private height = 0;
  private frame = 0;
  private roll: Roll | null = null;
  private readonly resize: ResizeObserver;
  private readonly themeWatch: MutationObserver;
  private readonly themePoll: ReturnType<typeof setInterval>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly watermark = "隠",
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(canvas);
    this.themeWatch = new MutationObserver(() => {
      this.colors = null;
    });
    this.themeWatch.observe(document.documentElement, { attributes: true });
    this.themePoll = setInterval(() => {
      this.colors = null;
    }, THEME_POLL_MS);
    this.measure();
    this.frame = requestAnimationFrame(this.draw);
  }

  setWindow(spec: WindowSpec): void {
    this.spec = spec;
    this.yMin = Number.NaN;
  }

  /** Replaces the history with `[ms, price]` points (any order). */
  setHistory(points: ReadonlyArray<readonly [number, number]>): void {
    const live = this.points.filter(([ts]) => ts > (points.at(-1)?.[0] ?? 0));
    this.points = [...points.map(([ts, p]) => [ts, p] as [number, number]), ...live]
      .filter(([, p]) => Number.isFinite(p))
      .sort((a, b) => a[0] - b[0])
      .slice(-MAX_POINTS);
  }

  /** A live tick. A tick at or before the last point replaces its price. */
  push(ts: number, price: number): void {
    if (!Number.isFinite(price)) return;
    const last = this.points.at(-1);
    if (last && ts <= last[0]) {
      last[1] = price;
    } else {
      this.points.push([ts, price]);
      if (this.points.length > MAX_POINTS) this.points.shift();
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    clearInterval(this.themePoll);
    this.resize.disconnect();
    this.themeWatch.disconnect();
  }

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private readColors(): Colors {
    const style = getComputedStyle(this.canvas);
    const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
      up: v("--up", "#34D399"),
      down: v("--down", "#FB7185"),
      accent: v("--accent", "#E04D26"),
      text: v("--foreground", "#FFFFFF"),
      muted: v("--muted-foreground", "#A3A3A3"),
      grid: v("--border", "rgba(255,255,255,0.1)"),
      ground: v("--stage", "#050505"),
      pillText: v("--background", "#050505"),
      mono: v("--font-family-mono", "ui-monospace, monospace"),
    };
  }

  private readonly draw = (now: number): void => {
    this.frame = requestAnimationFrame(this.draw);
    const { ctx, width, height, spec } = this;
    if (width === 0 || height === 0) return;
    this.colors ??= this.readColors();
    const colors = this.colors;
    ctx.clearRect(0, 0, width, height);

    const plotRight = width - AXIS_WIDTH;
    const plotBottom = height - PAD_BOTTOM;
    drawDots(this.ctx, colors, plotRight, plotBottom);
    drawWatermark(this.ctx, colors, this.watermark, plotRight, plotBottom);
    if (!spec || this.points.length === 0) return;

    const length = spec.closesAt - spec.opensAt;
    const lead = Math.min(LEAD_MAX_MS, Math.max(LEAD_MIN_MS, length * LEAD_FRACTION));
    const t0 = spec.opensAt - lead;
    const t1 = spec.closesAt;
    const visible = this.points.filter(([ts]) => ts >= t0 && ts <= t1);
    const series = visible.length > 0 ? visible : this.points.slice(-1);
    this.easeRange(series, spec.reference);

    const x = (ts: number) => PAD_LEFT + ((ts - t0) / (t1 - t0)) * (plotRight - PAD_LEFT);
    const y = (p: number) => PAD_TOP + ((this.yMax - p) / (this.yMax - this.yMin)) * (plotBottom - PAD_TOP);
    const head = series.at(-1) as [number, number];
    const headX = Math.min(plotRight, x(Math.max(head[0], Date.now())));

    this.drawGrid(colors, plotRight, plotBottom, y);
    this.drawFuture(colors, headX, plotRight, plotBottom);
    this.drawOpenMarker(colors, x(spec.opensAt), plotBottom);
    const refY = spec.reference === null ? null : y(spec.reference);
    this.drawLine(colors, series, x, y, refY, plotBottom);
    if (refY !== null) this.drawReference(colors, refY, plotRight, spec.referenceLabel);
    this.drawHead(colors, x(head[0]), y(head[1]), head[1], spec.reference, now);
    this.drawPill(colors, y(head[1]), plotRight, head[1], spec.reference, now);
  };

  private easeRange(series: Array<[number, number]>, reference: number | null): void {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const [, p] of series) {
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    if (reference !== null) {
      lo = Math.min(lo, reference);
      hi = Math.max(hi, reference);
    }
    const span = Math.max(hi - lo, hi * MIN_SPAN_FRACTION);
    const mid = (hi + lo) * HALF;
    const targetMin = mid - span * (HALF + RANGE_PAD);
    const targetMax = mid + span * (HALF + RANGE_PAD);
    if (Number.isNaN(this.yMin)) {
      this.yMin = targetMin;
      this.yMax = targetMax;
    } else {
      this.yMin += (targetMin - this.yMin) * RANGE_EASE;
      this.yMax += (targetMax - this.yMax) * RANGE_EASE;
    }
  }

  private drawGrid(colors: Colors, right: number, bottom: number, y: (p: number) => number): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = `500 ${AXIS_FONT_PX}px ${colors.mono}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let i = 0; i <= GRID_LINES; i += 1) {
      const p = this.yMax - ((this.yMax - this.yMin) * i) / GRID_LINES;
      const gy = y(p);
      ctx.globalAlpha = GRID_ALPHA;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, gy);
      ctx.lineTo(right, gy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.muted;
      if (gy > PAD_TOP && gy < bottom) ctx.fillText(formatPrice(p), right + LABEL_GAP, gy);
    }
    ctx.restore();
  }

  /** The time left in the window, shaded (Mitoshi: the stretch on the right is what's still to come). */
  private drawFuture(colors: Colors, headX: number, right: number, bottom: number): void {
    if (headX >= right) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = FUTURE_ALPHA;
    ctx.fillStyle = colors.text;
    ctx.fillRect(headX, PAD_TOP, right - headX, bottom - PAD_TOP);
    ctx.restore();
  }

  private drawOpenMarker(colors: Colors, openX: number, bottom: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = colors.grid;
    ctx.setLineDash([...REFERENCE_DASH]);
    ctx.beginPath();
    ctx.moveTo(openX, PAD_TOP);
    ctx.lineTo(openX, bottom);
    ctx.stroke();
    ctx.restore();
  }

  /** The line in mint above the reference and rose below it, each with a soft fill toward the reference. */
  private drawLine(
    colors: Colors,
    series: Array<[number, number]>,
    x: (ts: number) => number,
    y: (p: number) => number,
    refY: number | null,
    bottom: number,
  ): void {
    const { ctx, width } = this;
    const path = new Path2D();
    for (const [i, [ts, p]] of series.entries()) {
      if (i === 0) path.moveTo(x(ts), y(p));
      else path.lineTo(x(ts), y(p));
    }
    const split = refY ?? bottom;
    const firstX = x(series[0]?.[0] ?? 0);
    const lastX = x(series.at(-1)?.[0] ?? 0);
    const fill = new Path2D(path);
    fill.lineTo(lastX, split);
    fill.lineTo(firstX, split);
    fill.closePath();
    for (const [color, top, h] of [
      [colors.up, 0, split],
      [colors.down, split, this.height - split],
    ] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, width, h);
      ctx.clip();
      ctx.globalAlpha = FILL_ALPHA;
      ctx.fillStyle = color;
      ctx.fill(fill);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = refY === null ? colors.accent : color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineJoin = "round";
      ctx.stroke(path);
      ctx.restore();
    }
  }

  private drawReference(colors: Colors, refY: number, right: number, label: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = colors.muted;
    ctx.setLineDash([...REFERENCE_DASH]);
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, refY);
    ctx.lineTo(right, refY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 ${AXIS_FONT_PX}px ${colors.mono}`;
    ctx.fillStyle = colors.muted;
    ctx.textBaseline = "bottom";
    ctx.fillText(label, PAD_LEFT + LABEL_GAP, refY - LABEL_GAP * HALF);
    ctx.restore();
  }

  private drawHead(colors: Colors, hx: number, hy: number, price: number, ref: number | null, now: number): void {
    const { ctx } = this;
    const color = ref === null ? colors.accent : price >= ref ? colors.up : colors.down;
    const phase = (now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    ctx.save();
    ctx.globalAlpha = PULSE_ALPHA * (1 - phase);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(hx, hy, HEAD_RADIUS + (PULSE_RADIUS - HEAD_RADIUS) * phase, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, HEAD_RADIUS, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** The price pill on the axis; digits that changed roll in (up on a rise, down on a fall). */
  private drawPill(colors: Colors, py: number, right: number, price: number, ref: number | null, now: number): void {
    const { ctx } = this;
    const text = formatPrice(price);
    if (!this.roll || this.roll.to !== text) {
      this.roll = { from: this.roll?.to ?? text, to: text, started: now };
    }
    const t = Math.min(1, (now - this.roll.started) / ROLL_MS);
    const rising = Number(this.roll.to.replaceAll(",", "")) >= Number(this.roll.from.replaceAll(",", ""));
    ctx.save();
    ctx.font = `600 ${PILL_FONT_PX}px ${colors.mono}`;
    const w = ctx.measureText(text).width + PILL_PAD_X * 2;
    const x = right + 1;
    const top = py - PILL_HEIGHT * HALF;
    ctx.fillStyle = ref === null ? colors.accent : price >= ref ? colors.up : colors.down;
    ctx.beginPath();
    ctx.roundRect(x, top, Math.min(w, this.width - x), PILL_HEIGHT, PILL_RADIUS);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = colors.pillText;
    ctx.textBaseline = "middle";
    let cx = x + PILL_PAD_X;
    for (let i = 0; i < text.length; i += 1) {
      const to = text[i] as string;
      const from = this.roll.from[i] ?? to;
      const cw = ctx.measureText(to).width;
      if (from === to || t >= 1) {
        ctx.fillText(to, cx, py);
      } else {
        const shift = PILL_HEIGHT * (1 - t) * (rising ? 1 : -1);
        ctx.fillText(from, cx, py - PILL_HEIGHT * t * (rising ? 1 : -1));
        ctx.fillText(to, cx, py + shift);
      }
      cx += cw;
    }
    ctx.restore();
  }
}
