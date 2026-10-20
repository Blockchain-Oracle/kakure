import { INK_MIX } from "./constants";
import type { ArcadePalette, Rgb } from "./palette";

/**
 * The field's ink as `#RRGGBB` strings the draws can tint (Senryo's `ArcadeInk`, Mitoshi `sled-scene.ts`), from the
 * screen's palette triplets: the arena, a raised step of it, the ink, the two sides, the range tint and the accent.
 */
export interface SledInk {
  arena: string;
  raised: string;
  ink: string;
  up: string;
  down: string;
  range: string;
  accent: string;
}

const HEX_DIGITS = 2;
const HEX_RADIX = 16;
const BYTE_MAX = 255;
const HEX_COLOUR_LENGTH = 7;
/** Where each channel sits in `#RRGGBB`. */
const RED_AT = 1;
const GREEN_AT = 3;
const BLUE_AT = 5;

const hex = (c: Rgb): string =>
  `#${c
    .map((v) =>
      Math.max(0, Math.min(BYTE_MAX, Math.round(v)))
        .toString(HEX_RADIX)
        .padStart(HEX_DIGITS, "0"),
    )
    .join("")}`;

const blend = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function inkOf(p: ArcadePalette): SledInk {
  return {
    arena: hex(p.ground),
    raised: hex(blend(p.ground, p.ink, INK_MIX.raised)),
    ink: hex(p.ink),
    up: hex(p.up),
    down: hex(p.down),
    range: hex(blend(p.up, p.ink, INK_MIX.range)),
    accent: hex(p.accent),
  };
}

/** A `#RRGGBB` ink at `alpha`; anything else passes through (Senryo `tint`). */
export function tint(color: string, alpha: number): string {
  if (color.length !== HEX_COLOUR_LENGTH || color[0] !== "#") return color;
  const c = (i: number) => Number.parseInt(color.slice(i, i + HEX_DIGITS), HEX_RADIX);
  return `rgba(${c(RED_AT)}, ${c(GREEN_AT)}, ${c(BLUE_AT)}, ${alpha})`;
}
