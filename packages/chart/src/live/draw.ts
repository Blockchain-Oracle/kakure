import {
  GRID_ALPHA,
  GRID_OVERSCAN,
  LABEL_RIGHT,
  LEVEL_STYLE,
  MAJOR_TICK_ALPHA,
  MAJOR_TICK_PX,
  MINOR_TICK_ALPHA,
  MINOR_TICK_PX,
  PAD_Y,
  PILL_EDGE,
  PILL_H,
  PILL_H_POSITION,
  PILL_LABEL_CLEARANCE_PX,
  PILL_PITCH,
  PILL_PNL_OFFSET,
  PILL_PNL_PITCH,
  PILL_PRICE_OFFSET,
  PILL_PRICE_PITCH,
  PILL_RIGHT,
  PILL_TEXT_INSET,
  TAG_H,
  TAG_OFFSCREEN_ALPHA,
  TAG_OFFSCREEN_INSET,
  TAG_PAD,
  TAG_RADIUS,
  TICK_INSET_PX,
  WATERMARK,
  WATERMARK_ALPHA,
  WATERMARK_MAX_PX,
  WATERMARK_SHARE,
} from "./constants";
import { edgeAlpha, formatPrice, gridTicks, labelDecimals, type YWindow, yOf } from "./engine";
import type { CanvasOdometer } from "./odometer";
import type { ChartLevel, ChartTheme } from "./style";

/**
 * The chart's drawing primitives, shared by the line and candle views (Owarine `chart/chart-draw.ts`): the grid, the
 * axis, the watermark, level lines and tags, and the capsule pill. Each takes the context and the theme; no state.
 */
const HALF = 2;
const PIXEL = 0.5;

const span = (win: YWindow) => [win.center - win.half * GRID_OVERSCAN, win.center + win.half * GRID_OVERSCAN] as const;
const crisp = (y: number) => Math.round(y) + PIXEL;

export function drawWaiting(
  ctx: CanvasRenderingContext2D,
  theme: ChartTheme,
  text: string,
  w: number,
  h: number,
): void {
  ctx.font = theme.tagFont;
  ctx.fillStyle = theme.helper;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / HALF, h / HALF);
}

/** Major grid lines across the plot, at 6 % ink. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  theme: ChartTheme,
  win: YWindow,
  step: number,
  plotW: number,
): void {
  ctx.strokeStyle = theme.ink;
  ctx.globalAlpha = GRID_ALPHA;
  ctx.lineWidth = 1;
  for (const t of gridTicks(...span(win), step)) {
    if (!t.major) continue;
    const y = crisp(yOf(t.value, win));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Tick marks on both edges and major labels at the right, fading near the edges and the pill. */
export function drawAxis(
  ctx: CanvasRenderingContext2D,
  theme: ChartTheme,
  win: YWindow,
  step: number,
  w: number,
  headY: number,
  pillH: number,
): void {
  const decimals = labelDecimals(win.center, step);
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.helper;
  ctx.font = theme.axisFont;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of gridTicks(...span(win), step)) {
    const y = crisp(yOf(t.value, win));
    const edge = edgeAlpha(Math.min(y - win.top, win.bottom - y));
    if (edge <= 0) continue;
    const len = t.major ? MAJOR_TICK_PX : MINOR_TICK_PX;
    ctx.globalAlpha = (t.major ? MAJOR_TICK_ALPHA : MINOR_TICK_ALPHA) * edge;
    ctx.beginPath();
    ctx.moveTo(TICK_INSET_PX, y);
    ctx.lineTo(TICK_INSET_PX + len, y);
    ctx.moveTo(w - TICK_INSET_PX, y);
    ctx.lineTo(w - TICK_INSET_PX - len, y);
    ctx.stroke();
    if (!t.major) continue;
    ctx.globalAlpha = edge * edgeAlpha(Math.abs(y - headY) - (pillH / HALF + PILL_LABEL_CLEARANCE_PX));
    if (ctx.globalAlpha <= 0) continue;
    ctx.fillStyle = theme.helper;
    ctx.fillText(`$${formatPrice(t.value, decimals)}`, w - LABEL_RIGHT, y);
  }
  ctx.globalAlpha = 1;
}

/** 隠 behind everything at 7 %, at most half the plot (260 px) wide. */
export function drawWatermark(ctx: CanvasRenderingContext2D, theme: ChartTheme, plotW: number, h: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.globalAlpha = WATERMARK_ALPHA;
  ctx.font = theme.markFont;
  ctx.fillStyle = theme.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const scale = Math.min(WATERMARK_SHARE * plotW, WATERMARK_MAX_PX) / (ctx.measureText(WATERMARK).width || 1);
  ctx.translate(plotW / HALF, h / HALF);
  ctx.scale(scale, scale);
  ctx.fillText(WATERMARK, 0, 0);
  ctx.restore();
}

function tag(
  ctx: CanvasRenderingContext2D,
  theme: ChartTheme,
  text: string,
  x: number,
  y: number,
  width: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width, TAG_H, TAG_RADIUS);
  ctx.fill();
  // Ink tags (Entry) carry the inverse ink; coloured tags carry the pill's ink.
  ctx.fillStyle = fill === theme.ink ? theme.inverse : theme.onLine;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + TAG_PAD, y + TAG_H / HALF + PIXEL);
}

/** A level's dashed line and axis tag, or, off-screen, a tag pinned inside the edge pointing the way. */
export function drawLevel(
  ctx: CanvasRenderingContext2D,
  theme: ChartTheme,
  level: ChartLevel,
  win: YWindow,
  plotW: number,
  w: number,
  tone: string,
): void {
  const style = LEVEL_STYLE[level.kind];
  const colour =
    level.kind === "line"
      ? theme.down
      : level.kind === "breakeven"
        ? theme.breakeven
        : level.kind === "trail"
          ? tone
          : theme.ink;
  const y = yOf(level.price, win);
  ctx.font = style.strong ? theme.tagStrongFont : theme.tagFont;
  if (y < win.top - HALF || y > win.bottom + HALF) {
    const up = y < win.top;
    const text = `${up ? "▲" : "▼"} ${level.label} $${formatPrice(level.price)}`;
    ctx.font = theme.tagStrongFont;
    const tw = ctx.measureText(text).width + TAG_PAD * HALF;
    ctx.globalAlpha = TAG_OFFSCREEN_ALPHA;
    const at = up ? win.top - PAD_Y + TAG_OFFSCREEN_INSET : win.bottom + PAD_Y - TAG_OFFSCREEN_INSET - TAG_H;
    tag(ctx, theme, text, w - LABEL_RIGHT - tw, at, tw, colour);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.globalAlpha = style.alpha;
  ctx.lineWidth = style.width;
  ctx.setLineDash([...style.dash]);
  ctx.beginPath();
  ctx.moveTo(0, crisp(y));
  ctx.lineTo(plotW, crisp(y));
  ctx.stroke();
  ctx.restore();
  const tw = ctx.measureText(level.label).width + TAG_PAD * HALF;
  tag(ctx, theme, level.label, w - LABEL_RIGHT - tw, y - TAG_H / HALF, tw, colour);
}

/** The capsule pill at the axis: the price rolling, and with a position the PnL beneath it; kept inside the canvas. */
export function drawPill(
  ctx: CanvasRenderingContext2D,
  theme: ChartTheme,
  w: number,
  h: number,
  headY: number,
  pillW: number,
  tone: string,
  price: CanvasOdometer,
  pnl: CanvasOdometer | null,
): void {
  const pillH = pnl ? PILL_H_POSITION : PILL_H;
  const x = w - PILL_RIGHT - pillW;
  const y = Math.min(h - pillH - PILL_EDGE, Math.max(PILL_EDGE, headY - pillH / HALF));
  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.roundRect(x, y, pillW, pillH, pillH / HALF);
  ctx.fill();
  ctx.fillStyle = theme.onLine;
  const right = x + pillW - PILL_TEXT_INSET;
  if (!pnl) {
    ctx.font = theme.pillFont;
    price.draw(ctx, right, y + pillH / HALF + PIXEL, PILL_PITCH, y, y + pillH);
    return;
  }
  const mid = y + pillH / HALF;
  ctx.font = theme.pillPriceFont;
  price.draw(ctx, right, mid - PILL_PRICE_OFFSET, PILL_PRICE_PITCH, y, mid);
  ctx.font = theme.pillPnlFont;
  pnl.draw(ctx, right, mid + PILL_PNL_OFFSET, PILL_PNL_PITCH, mid, y + pillH);
}
