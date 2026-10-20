import {
  DOT_DRIFT_CLAMP,
  DOT_DRIFT_EASE,
  DOT_DRIFT_GAIN,
  DOT_DRIFT_WRAP,
  DOT_RADIUS,
  DOT_SCROLL_SHARE,
  DOT_SPACING,
  MAX_DPR,
} from "./constants";
import type { FrameInfo } from "./style";

/**
 * The parallax dot field behind the chart (Owarine `chart/dot-grid.ts`, Tradash's `DotGrid`): dots every 34 px,
 * scrolling left at half the line's speed and drifting with the price's motion in grid steps, so BTC and a $0.07 asset
 * move it alike.
 */
export class DotGrid {
  private ctx: CanvasRenderingContext2D;
  private offsetX = 0;
  private targetY = 0;
  private offsetY = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private colour: string,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    this.ctx = ctx;
  }

  setColour(colour: string): void {
    this.colour = colour;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
  }

  /** Follows one chart frame (or holds still when the chart has no price yet). */
  frame(info: FrameInfo | null, reduced: boolean): void {
    if (info && !reduced) {
      this.offsetX = (this.offsetX - DOT_SCROLL_SHARE * info.scrollX) % DOT_SPACING;
      const drift = DOT_DRIFT_GAIN * info.velocitySteps * DOT_SPACING;
      this.targetY += Math.max(-DOT_DRIFT_CLAMP, Math.min(DOT_DRIFT_CLAMP, drift));
      this.targetY %= DOT_SPACING * DOT_DRIFT_WRAP;
      this.offsetY += (this.targetY - this.offsetY) * DOT_DRIFT_EASE;
    }
    const { ctx, width: w, height: h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.colour;
    const ox = ((this.offsetX % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
    const oy = ((this.offsetY % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
    ctx.beginPath();
    for (let x = ox - DOT_SPACING; x < w + DOT_SPACING; x += DOT_SPACING) {
      for (let y = oy - DOT_SPACING; y < h + DOT_SPACING; y += DOT_SPACING) {
        ctx.moveTo(x + DOT_RADIUS, y);
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
}
