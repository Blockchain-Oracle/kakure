/**
 * Every tunable of the Window chart (Mitoshi's Window chart and Owarine's terminal, mitoshi-code-study §3.3):
 * a time-based axis from a lead before the open to the close, the opening print as the reference line, the line
 * mint above it and rose below, the time left shaded, an eased y-range, a pulsing live head and a rolling price pill.
 */

export const MS_PER_MINUTE = 60_000;
/** The axis starts this long before the window opens: a quarter of the window, between 5 and 30 minutes. */
export const LEAD_FRACTION = 0.25;
export const LEAD_MIN_MS = 5 * MS_PER_MINUTE;
export const LEAD_MAX_MS = 30 * MS_PER_MINUTE;

/** The y-range eases toward its target by this fraction each frame, so new highs glide in. */
export const RANGE_EASE = 0.08;
/** Headroom above and below the data, as a fraction of its span. */
export const RANGE_PAD = 0.18;
/** A flat series still gets this much span, as a fraction of the price (0.05 %). */
export const MIN_SPAN_FRACTION = 0.0005;

/** Layout, in CSS pixels. */
export const AXIS_WIDTH = 76;
export const PAD_TOP = 18;
export const PAD_BOTTOM = 26;
export const PAD_LEFT = 12;
export const DOT_SPACING = 22;
export const DOT_RADIUS = 1;
export const GRID_LINES = 4;
export const LINE_WIDTH = 2;
export const HEAD_RADIUS = 4;
export const PULSE_RADIUS = 14;
export const PULSE_PERIOD_MS = 1_600;
export const PILL_HEIGHT = 22;
export const PILL_RADIUS = 11;
export const PILL_PAD_X = 8;
export const REFERENCE_DASH = [4, 4] as const;
export const LABEL_GAP = 6;

/** Fonts are set from the page's tokens at draw time; sizes in CSS pixels. */
export const AXIS_FONT_PX = 11;
export const PILL_FONT_PX = 12;
export const WATERMARK_FONT_PX = 180;

/** Opacities. */
export const DOT_ALPHA = 0.18;
export const GRID_ALPHA = 0.5;
export const FILL_ALPHA = 0.14;
export const FUTURE_ALPHA = 0.045;
export const WATERMARK_ALPHA = 0.045;
export const PULSE_ALPHA = 0.35;

/** The rolling digits on the price pill (Mitoshi's canvas odometer): each changed digit slides in this long. */
export const ROLL_MS = 260;

/** Points kept in memory, and how often the theme colours are re-read when nothing announced a change. */
export const MAX_POINTS = 6_000;
export const THEME_POLL_MS = 2_000;

/** Prices format with grouping and enough decimals for the size of the number. */
export const DECIMALS_BY_MAGNITUDE: ReadonlyArray<readonly [number, number]> = [
  [1_000, 2],
  [1, 2],
  [0.01, 4],
  [0, 6],
];
