import {
  DECIMALS_BY_MAGNITUDE,
  DOT_ALPHA,
  DOT_RADIUS,
  DOT_SPACING,
  PAD_LEFT,
  PAD_TOP,
  WATERMARK_ALPHA,
  WATERMARK_FONT_PX,
} from "./constants";

/** Token colours the chart draws with, read from the page (see `WindowChart.readColors`). */
export interface Colors {
  up: string;
  down: string;
  accent: string;
  text: string;
  muted: string;
  grid: string;
  ground: string;
  pillText: string;
  mono: string;
}

const HALF = 0.5;

export function drawDots(ctx: CanvasRenderingContext2D, colors: Colors, right: number, bottom: number): void {
  ctx.save();
  ctx.globalAlpha = DOT_ALPHA;
  ctx.fillStyle = colors.muted;
  for (let dx = PAD_LEFT; dx < right; dx += DOT_SPACING) {
    for (let dy = PAD_TOP; dy < bottom; dy += DOT_SPACING) {
      ctx.fillRect(dx, dy, DOT_RADIUS, DOT_RADIUS);
    }
  }
  ctx.restore();
}

export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  colors: Colors,
  mark: string,
  right: number,
  bottom: number,
): void {
  ctx.save();
  ctx.globalAlpha = WATERMARK_ALPHA;
  ctx.fillStyle = colors.text;
  ctx.font = `700 ${WATERMARK_FONT_PX}px "Noto Serif JP", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(mark, right * HALF, (bottom + PAD_TOP) * HALF);
  ctx.restore();
}

/** Grouped, with decimals sized to the price. */
export function formatPrice(price: number): string {
  const decimals = DECIMALS_BY_MAGNITUDE.find(([floor]) => Math.abs(price) >= floor)?.[1] ?? 2;
  return price.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
