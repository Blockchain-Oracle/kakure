/**
 * Every tunable of the live terminal chart, ported from Owarine's engine (`owarine/web/src/features/terminal/chart/*`,
 * Tradash's model): the line is the last ~10 s of eased motion, re-centred on the price every frame; candles add history
 * at Owarine's intervals. Values and their reasons are Owarine's unless noted.
 */

/* ── The line ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Samples kept on screen: ~10 s at the 60 Hz sample clock. */
export const SAMPLE_CAPACITY = 600;
export const SAMPLE_MS = 1000 / 60;
/** Per-sample approach of the eased price to the latest tick (0.18 a frame at 60 Hz: τ ≈ 84 ms). */
export const PRICE_EASE = 0.18;
/** Per-sample approach of a rolling digit, and its snap threshold. */
export const DIGIT_EASE = 0.22;
export const DIGIT_SNAP = 0.002;
/** The plot spans this many grid steps top to bottom, centred on the price. */
export const SPAN_STEPS = 15;
/** One step ≈ this fraction of price (0.01 %) before rounding to a nice number. */
export const STEP_FRACTION = 1e-4;
/** The left fraction of the plot that fades out (alpha 1 → 0.55 at 45 % of it → 0). */
export const FADE_FRACTION = 0.32;
export const FADE_MID_STOP = 0.45;
export const FADE_MID_ALPHA = 0.55;
/** A frame catches up at most this many samples (a backgrounded tab returns smoothly). */
export const MAX_SAMPLES_PER_FRAME = 8;
/** The longest frame step counted, so a long pause doesn't jump. */
export const MAX_FRAME_MS = 250;
/** The eased price snaps to the tick once within this fraction of it. */
export const EASE_SNAP_FRACTION = 1e-7;
export const LINE_WIDTH = 2;
export const GLOW_WIDTH = 6;
export const GLOW_ALPHA = 0.18;
export const HEAD_RADIUS = 3.5;

/* ── Nice numbers and labels ──────────────────────────────────────────────────────────────────────────────────── */

/** Nice steps: 1, 2, 5 or 10 × 10ⁿ with cut-offs 1.5 / 3.5 / 7.5. */
export const NICE_CUTS = [1.5, 3.5, 7.5] as const;
export const NICE_STEPS = [1, 2, 5, 10] as const;
/** Display decimals by magnitude. */
export const DECIMALS_BY_MAGNITUDE: ReadonlyArray<readonly [number, number]> = [
  [1e5, 1],
  [1e3, 2],
  [10, 3],
  [0.01, 4],
];
export const SMALL_PRICE_SIGNIFICANT = 3;
export const MAX_DECIMALS = 10;
/** Minor grid ticks every step / 5; a major every step. */
export const MINOR_PER_MAJOR = 5;
export const MAX_GRID_TICKS = 400;
/** The grid extends past the visible window by this factor (labels fade at the edges). */
export const GRID_OVERSCAN = 1.2;
export const GRID_ALPHA = 0.06;
export const MAJOR_TICK_PX = 6;
export const MINOR_TICK_PX = 3;
export const TICK_INSET_PX = 3;
export const MAJOR_TICK_ALPHA = 0.9;
export const MINOR_TICK_ALPHA = 0.45;
/** Labels fade over this many px near an edge or the pill. */
export const EDGE_FADE_PX = 14;
export const PILL_LABEL_CLEARANCE_PX = 4;

/* ── Layout ───────────────────────────────────────────────────────────────────────────────────────────────────── */

export const PAD_Y = 28;
export const PILL_RIGHT = 14;
export const PILL_GAP = 10;
export const MIN_PLOT_LEFTOVER = 96;
export const PILL_H = 26;
export const PILL_H_POSITION = 34;
export const PILL_PAD_X = 18;
export const PILL_TEXT_INSET = 9;
export const PILL_EDGE = 2;
/** Odometer roll pitch: one row of the plain pill, the price and PnL rows of the position pill. */
export const PILL_PITCH = 20;
export const PILL_PRICE_PITCH = 16;
export const PILL_PNL_PITCH = 14;
export const PILL_PRICE_OFFSET = 7;
export const PILL_PNL_OFFSET = 8;
export const LABEL_RIGHT = 14;
export const TAG_H = 15;
export const TAG_PAD = 5;
export const TAG_RADIUS = 3;
export const TAG_OFFSCREEN_INSET = 9;
export const TAG_OFFSCREEN_ALPHA = 0.9;
/** The canvas renders at no more than this device scale. */
export const MAX_DPR = 2;
/** Below this size the chart shows its waiting text. */
export const MIN_CANVAS_PX = 40;

/* ── Watermark: Kakure's 隠 (Owarine draws 終値) ──────────────────────────────────────────────────────────────── */

export const WATERMARK = "隠";
export const WATERMARK_ALPHA = 0.07;
/** At most half the plot, and this many px wide. */
export const WATERMARK_SHARE = 0.5;
export const WATERMARK_MAX_PX = 260;

/* ── The PnL band ─────────────────────────────────────────────────────────────────────────────────────────────── */

export const BAND_TOP_ALPHA = 0.22;
export const BAND_BOTTOM_ALPHA = 0.02;

/* ── View swap: the canvas fades out, swaps, fades in ─────────────────────────────────────────────────────────── */

export const FADE_OUT_STEP = 0.35;
export const FADE_IN_STEP = 0.2;
export const FADE_DONE = 0.04;
export const FADE_FULL = 0.99;
export const VIEW_SWAP_TIMEOUT_MS = 2_500;
export const OPACITY_DECIMALS = 1000;

/* ── Dot grid ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const DOT_SPACING = 34;
export const DOT_RADIUS = 1.1;
/** It scrolls at half the line's speed and drifts with the price's motion, measured in grid steps. */
export const DOT_SCROLL_SHARE = 0.5;
export const DOT_DRIFT_GAIN = 4;
export const DOT_DRIFT_CLAMP = 6;
export const DOT_DRIFT_EASE = 0.06;
export const DOT_DRIFT_WRAP = 1000;

/* ── Candles ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export const CANDLE_CAP = 3_000;
/** The newest candle slides in from the right after a rollover, decaying this much a frame. */
export const SLIDE_DECAY = 0.86;
export const SLIDE_DONE = 0.002;
/** Px per candle: plot width / 48 by default, clamped; the pinch range. */
export const SPACING_MIN = 1.5;
export const SPACING_MAX = 40;
export const SPACING_DEFAULT_MIN = 5;
export const SPACING_DEFAULT_MAX = 14;
export const SPACING_DEFAULT_DIVISOR = 48;
export const BODY_SHARE = 0.64;
/** Auto y-step from the visible bodies: nice(max(2·dev·1.15, 0.15 % of price) / 15). */
export const CANDLE_DEV_FACTOR = 2.3;
export const CANDLE_MIN_SPAN_FRACTION = 1.5e-3;
export const CANDLE_HALF_STEPS = 7.5;
export const CANDLE_INITIAL = 300;
export const CANDLE_REFRESH_COUNT = 3;
/** The last candles are re-read this long after each boundary. */
export const CANDLE_REFRESH_AFTER_MS = 4_000;
export const CANDLE_RETRY_MS = 3_000;
/** Older history is fetched once the view is this many candles from the oldest. */
export const CANDLE_OLDER_WITHIN = 20;
export const TAP_MS = 300;
export const TAP_PX = 6;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 24;
export const RECENTRE_EASE = 0.2;
export const RECENTRE_DONE_OFFSET = 0.02;
export const RECENTRE_DONE_HALF = 0.002;
export const OFF_CENTRE_OFFSET = 0.5;
/** Panning stops this far past the newest candle (a share of the visible slots) and three short of the oldest. */
export const PAN_PAST_NEWEST = 0.6;
export const PAN_KEEP_OLDEST = 3;
export const AXIS_DRAG_RATE = 0.006;
export const WHEEL_SCALE_RATE = 0.002;
export const WHEEL_ZOOM_RATE = 0.0015;
export const WHEEL_PINCH_RATE = 0.01;
export const LIVE_DASH = [3, 3] as const;
export const LIVE_DASH_ALPHA = 0.45;
export const CROSSHAIR_DASH = [4, 4] as const;
export const CROSSHAIR_ALPHA = 0.75;
export const CROSSHAIR_OVERHANG = 20;
export const CROSSHAIR_PILL_H = 22;
export const CROSSHAIR_PILL_PAD = 8;
export const CROSSHAIR_PILL_RIGHT = 14;
/** Slots drawn beyond the visible width (one each side). */
export const SLOT_OVERSCAN = 2;

/* ── Levels: dash, width, alpha ───────────────────────────────────────────────────────────────────────────────── */

export const LEVEL_STYLE = {
  entry: { dash: [4, 4], width: 1, alpha: 0.55, strong: false },
  breakeven: { dash: [1, 3], width: 1, alpha: 0.75, strong: false },
  line: { dash: [2, 3], width: 1, alpha: 0.7, strong: false },
  trail: { dash: [6, 3], width: 1.5, alpha: 1, strong: true },
} as const;

/** A token colour at an alpha needs these to rebuild `rgba(…)`. */
export const HEX_RADIX = 16;
export const HEX_COLOUR_LENGTH = 7;
