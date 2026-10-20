import { HEX_COLOUR_LENGTH, HEX_RADIX, type LEVEL_STYLE } from "./constants";

/** The chart's shared types and the token-colour-at-alpha helper (Owarine `chart/chart-style.ts`). */

/** Colours and fonts, read from the page's tokens by the React wrapper. */
export type ChartTheme = Record<"up" | "down" | "ink" | "inverse" | "helper" | "onLine" | "breakeven", string> &
  Record<"axisFont" | "pillFont" | "pillPriceFont" | "pillPnlFont" | "tagFont" | "tagStrongFont" | "markFont", string>;

export type LevelKind = keyof typeof LEVEL_STYLE;

export interface ChartLevel {
  kind: LevelKind;
  price: number;
  label: string;
}

/**
 * What the chart draws over the price: the Window's levels (Mitoshi's line to beat, drawn while flat too) and, while
 * holding, the position's PnL. Null with no Window on screen.
 */
export interface ChartOverlay {
  /** Its sign picks the line's colour (≥ 0 is up): the live PnL while holding, else the price against the Line. */
  tone: number;
  /** The pill's second row while holding ("+0.0370"); null when flat. */
  pnlText: string | null;
  /** The band runs between the line and this price (the entry); null when flat. */
  entry: number | null;
  levels: ChartLevel[];
}

export interface FrameInfo {
  price: number;
  /** Eased price change this frame, in grid steps (the dot grid's parallax). */
  velocitySteps: number;
  /** Pixels the view scrolled this frame. */
  scrollX: number;
  headX: number;
  headY: number;
}

export type ChartView = "line" | "candles";

const alphaCache = new Map<string, string>();
const HEX_PAIR = 2;
const R = 1;
const G = 3;
const B = 5;
const RGB_PARTS = 3;

/** A token colour at an alpha, via the canvas's own parser (hex, rgb() and named colours). */
export function withAlpha(ctx: CanvasRenderingContext2D, colour: string, alpha: number): string {
  const key = `${colour}|${alpha}`;
  const hit = alphaCache.get(key);
  if (hit) return hit;
  ctx.fillStyle = colour;
  const parsed = String(ctx.fillStyle);
  let out = colour;
  if (parsed.startsWith("#") && parsed.length === HEX_COLOUR_LENGTH) {
    const channel = (at: number) => Number.parseInt(parsed.slice(at, at + HEX_PAIR), HEX_RADIX);
    out = `rgba(${channel(R)},${channel(G)},${channel(B)},${alpha})`;
  } else if (parsed.startsWith("rgb")) {
    out = parsed.replace(
      /rgba?\(([^)]+)\)/,
      (_, inner: string) => `rgba(${inner.split(",").slice(0, RGB_PARTS).join(",")},${alpha})`,
    );
  }
  alphaCache.set(key, out);
  return out;
}
