/**
 * The arcade screen's figures (Mitoshi `features/games/arcade/*`, from Senryo's arcade): the field's fixed ink, the
 * heat ramp, the stage's timings, and the attract loop. The engines' own numbers live in `packages/arcade`.
 */

/** The field's ground is part of the mechanic (the line's heat, the candles, the grip all read against it), so its ink
 * is fixed in both themes: Kakure's dark values as `r g b` (packages/tokens: canvas, foreground, up, down, vermilion). */
export const ARCADE_INK = {
  ground: [5, 5, 5],
  ink: [255, 255, 255],
  up: [52, 211, 153],
  down: [251, 113, 133],
  accent: [224, 77, 38],
} as const satisfies Record<string, readonly [number, number, number]>;

/** Pips's heat: cool at ×1, warm around ×4, hot from ×8. */
export const HEAT = { span: 7, mid: 0.5 } as const;

/** 3-2-1-GO: each count 600 ms. */
export const COUNT_MS = 600;
export const COUNT_FROM = 3;
/** A key still held from the run (Space) mustn't land on the focused Play again: the card listens after a beat. */
export const CARD_READY_MS = 600;
/** The run layer loads while the cabinet idles, this long after it opens. */
export const PRELOAD_RUN_MS = 1_500;
/** The HUD reads the engine every few steps; the attract loop starts a fresh run a beat after each ends. */
export const HUD_EVERY_TICKS = 3;
export const ATTRACT_RESTART_TICKS = 90;
/** The grip meter's cells. */
export const GRIP_SEGMENTS = 10;
/** The rank line says "#n" in the top ten, "Rank #n" below. */
export const TOP_TEN = 10;
export const MS_PER_SEC = 1_000;
export const LENGTH_DECIMALS = 1;

/** The raised ground is the arena 8 % toward the ink; the range tint is the up side 45 % toward it. */
export const INK_MIX = { raised: 0.08, range: 0.45 } as const;
/** A palette triplet is `r g b`. */
export const TRIPLET = 3;

/** The arcade cues' figures (Mitoshi `arcade/arcade-sfx.ts`, by value): A minor, under the games' effects slider. */
export const SFX = {
  floor: 0.0001,
  attackSec: 0.008,
  tailSec: 0.02,
  noiseTailSec: 0.05,
  sweepQ: 0.7,
  sweepGlide: 0.8,
  sweepRise: 0.3,
  thud: { fromHz: 170, toHz: 40, glideSec: 0.45, riseSec: 0.02, decaySec: 0.55, stopSec: 0.58 },
  hopScore: {
    baseHz: 783.99,
    climbOctaves: 0.75,
    streakCap: 40,
    scoopFrom: 0.86,
    scoopSec: 0.05,
    peak: 0.12,
    decaySec: 0.16,
    stopSec: 0.18,
    shimmerAtSec: 0.012,
    shimmerSec: 0.1,
    shimmerPeak: 0.04,
  },
  hopCrash: {
    cutoffFromHz: 1_800,
    cutoffToHz: 260,
    closeSec: 0.55,
    peak: 0.2,
    riseSec: 0.02,
    decaySec: 0.62,
    voices: [
      { hz: 330, detune: -7 },
      { hz: 494, detune: 7 },
    ],
    slide: 0.66,
    slideSec: 0.5,
    stopSec: 0.64,
    thudPeak: 0.22,
  },
  rideStart: {
    sweepHz: { from: 300, to: 2_600 },
    sweepSec: 0.6,
    sweepPeak: 0.08,
    /** A4 C5 E5 A5: the run's opening lift. */
    bloomHz: [440, 523.25, 659.25, 880],
    bloomLeadSec: 0.05,
    bloomGapSec: 0.06,
    bloomSec: 0.5,
    bloomPeak: 0.06,
  },
  rideCrash: {
    thudPeak: 0.26,
    /** A5 G5 E5 C5 A4: the wipeout's fall. */
    tumbleHz: [880, 783.99, 659.25, 523.25, 440],
    tumbleLeadSec: 0.04,
    tumbleGapSec: 0.07,
    tumbleSec: 0.3,
    tumblePeak: 0.07,
    sweepHz: { from: 2_600, to: 300 },
    sweepSec: 0.55,
    sweepPeak: 0.06,
  },
  milestone: {
    baseHz: 1_046.5,
    maxSteps: 12,
    tickSec: 0.09,
    tickPeak: 0.05,
    shimmerAtSec: 0.01,
    shimmerSec: 0.07,
    shimmerPeak: 0.03,
  },
  regain: { hz: 440, sec: 0.06, peak: 0.05 },
  count: {
    beepHz: 880,
    goHz: 1_760,
    beepSec: 0.12,
    goSec: 0.28,
    peak: 0.06,
    goUnderHz: 1_318.51,
    goUnderAtSec: 0.02,
    goUnderSec: 0.24,
    goUnderPeak: 0.04,
  },
} as const;

/** A flip's tick sits above the combo ticks (Mitoshi: `8 + n`). */
export const FLIP_TICK_BASE = 8;
