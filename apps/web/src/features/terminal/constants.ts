/**
 * The terminal's tunables (Owarine `features/terminal/settings.ts`, `TerminalScreen.tsx`, Tradash's model) in Kakure's
 * units: stakes in zatoshi on the chip grid.
 */

/** The default stake follows this share of what is available (Tradash's 5 %), never under the minimum stake. */
export const DEFAULT_SIZE_SHARE = 0.05;
/** Trail distances offered (fractions): 0.10 %, 0.50 %, 1 %, 2 %; the slider runs 0.1 %–10 %. */
export const TRAIL_CHOICES = [0.001, 0.005, 0.01, 0.02] as const;
export const TRAIL_MIN = 0.001;
export const TRAIL_MAX = 0.1;
export const TRAIL_SLIDER_STEP = 0.1;
export const MUSIC_TRACKS = ["arcade", "rush", "night"] as const;
/** Tradash's one breakpoint: 1024 CSS px. */
export const DESKTOP_QUERY = "(min-width: 64em)";
/** Prices commit to React at most this often per symbol (Tradash, 200 ms leading edge). */
export const COMMIT_MS = 200;
/** The music track chip stays this long after a change. */
export const TRACK_CHIP_MS = 4_000;
/** The candle view's off-centre check. */
export const OFF_CENTRE_POLL_MS = 300;
/** Percent and basis-point scales. */
export const PERCENT = 100;
export const BPS = 10_000;
/** Size presets in the settings sheet: shares of what is available. */
export const SIZE_PRESETS = [0.25, 0.5] as const;
/** Add / Reduce start at half of the most, with these chips. */
export const ADJUST_START_SHARE = 0.5;
export const ADD_CHIPS = [0.25, 0.5, 0.75, 1] as const;
export const REDUCE_CHIPS = [0.25, 0.5, 0.75] as const;
/** Reduce sells at most this share (the rest stays a position; Owarine 0.95). */
export const REDUCE_MAX_SHARE = 0.95;
/** Add uses at most this share of what is available (Owarine 0.98). */
export const ADD_MAX_SHARE = 0.98;

/* ── Toasts (Owarine `terminal/toasts.tsx`, Tradash's toast system) ──────────────────────────────────────────── */

export const TOAST_LIFETIME_MS = { success: 3_500, error: 5_000, info: 3_500 } as const;
export const TOAST_MAX = 3;
/** Confetti on a win: two emitters at 18 % and 82 % of the width, 34 particles each, 1.1 s, fading after half. */
export const CONFETTI = {
  emitters: [0.18, 0.82],
  perEmitter: 34,
  durationMs: 1_100,
  fadeFrom: 0.5,
  startY: 0.86,
  speedMin: 3.6,
  speedSpread: 3.4,
  angleSpread: 0.9,
  angleLean: 0.42,
  gravity: 0.14,
  dragMin: 0.982,
  dragSpread: 0.012,
  sizeMinW: 4,
  sizeSpreadW: 4,
  sizeMinH: 6,
  sizeSpreadH: 6,
  spin: 0.4,
  maxDpr: 2,
} as const;

/** Tradash's money decimals by magnitude: 1 from 100,000, 2 from 1,000, 3 from 10, else 4. */
export const MONEY_MAGNITUDES: ReadonlyArray<readonly [number, number]> = [
  [1e5, 1],
  [1e3, 2],
  [10, 3],
];
/** Prices read as cents of a whole payout ("52.5¢"). */
export const CENTS_PER_UNIT = 100;

/** The tour's illustrated steps (0-based): the PnL pill shows on 2 and 4, the trail line and chip on 3, Close on 4. */
export const TOUR_STEP = { buttons: 1, pnl: 2, trail: 3, close: 4 } as const;
