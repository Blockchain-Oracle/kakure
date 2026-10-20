import { ARCADE_INK, HEAT, TRIPLET } from "./constants";

/**
 * The screen's colours, read off its CSS once per resize.
 *
 * `arcade.css` declares the field's ink, ground and the venue's two sides as `r g b` triplets on
 * `.ar-screen`; the draw modules build every stroke from those numbers and an alpha. No hex, no
 * literal, and a change to the tokens reaches the canvas without a line of TypeScript moving.
 */
export type Rgb = readonly [number, number, number];

export interface ArcadePalette {
  ground: Rgb;
  ink: Rgb;
  up: Rgb;
  down: Rgb;
  accent: Rgb;
  /** The games' pixel face as a canvas font family (next/font's generated name, read off `--font-pixel`). */
  font: string;
}

const FALLBACK: Omit<ArcadePalette, "font"> = ARCADE_INK;
const FONT_FALLBACK = "ui-monospace, monospace";

function triplet(raw: string, fallback: Rgb): Rgb {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < TRIPLET || parts.some((n) => !Number.isFinite(n))) return fallback;
  return [parts[0] as number, parts[1] as number, parts[2] as number];
}

export function readPalette(el: Element): ArcadePalette {
  const style = getComputedStyle(el);
  const read = (name: string, fallback: Rgb) => triplet(style.getPropertyValue(name), fallback);
  return {
    ground: read("--ar-ground-rgb", FALLBACK.ground),
    ink: read("--ar-ink-rgb", FALLBACK.ink),
    up: read("--ar-up-rgb", FALLBACK.up),
    down: read("--ar-down-rgb", FALLBACK.down),
    accent: read("--ar-accent-rgb", FALLBACK.accent),
    font: style.getPropertyValue("--font-pixel").trim() || FONT_FALLBACK,
  };
}

export const rgb = (c: Rgb): string => `rgb(${c[0]} ${c[1]} ${c[2]})`;
export const rgba = (c: Rgb, alpha: number): string => `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`;

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Pips's heat: the line's colour climbs with the combo — cool at ×1, warm around ×4, hot from ×8.
 * The venue's mint, signal and rose stand in for the reference's cyan, amber and red.
 */
export function heatOf(palette: ArcadePalette, mult: number): Rgb {
  const t = Math.min(1, Math.max(0, (mult - 1) / HEAT.span));
  return t < HEAT.mid
    ? mix(palette.up, palette.accent, t / HEAT.mid)
    : mix(palette.accent, palette.down, (t - HEAT.mid) / HEAT.mid);
}
