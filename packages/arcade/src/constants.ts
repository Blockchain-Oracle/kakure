/**
 * Every tunable of the arcade engines. The engines run in the browser (play) and in the arcade worker (replay to
 * verify a score), so the simulation uses only + − × ÷, comparisons, min/max/floor and `Math.sqrt` (IEEE 754
 * correctly rounded): the same seed, tape and input trace give the same score on every JavaScript engine.
 * Rules and numbers follow the user's earlier arcade games (Mitoshi/Senryo studies); the code is written fresh.
 */

/** The field, in world pixels, and the fixed simulation step. */
export const FIELD_W = 640;
export const FIELD_H = 360;
export const STEP_HZ = 60;
export const STEP_SEC = 1 / STEP_HZ;
/** Every run ends by this many ticks (30 minutes). */
export const MAX_RUN_TICKS = 30 * 60 * STEP_HZ;
/** A trace longer than this many inputs is refused before replay. */
export const MAX_TRACE_INPUTS = 20_000;

/** Prices map into this vertical band of the field (y grows down). */
export const BAND_TOP = 70;
export const BAND_BOTTOM = 300;

/** Candle Hop. */
export const HOP = {
  coinX: 160,
  coinRadius: 9,
  gravity: 1_500,
  /** A tap sets the coin's vertical speed to this (px/s, upward). */
  tapSpeed: -420,
  maxFall: 700,
  /** One candle pair per tape move, this far apart. */
  spacing: 150,
  firstCandleX: 520,
  bodyWidth: 34,
  /** The gap narrows and the scroll speeds up over the ramp (seconds). */
  gap0: 120,
  gap1: 88,
  speed0: 150,
  speed1: 205,
  rampSec: 60,
  /** Calm mode (reduced motion): a wider floor for the gap and a slower ramp. */
  calmGap1: 100,
  calmStretch: 1.6,
} as const;

/** Line Rider. */
export const RIDE = {
  /** Terrain points every `seg` px; one tape move spreads over `segsPerMove` points. */
  seg: 24,
  segsPerMove: 2,
  /** The tape's mean move maps to this many px at the start; leverage steepens it over `wildSec`. */
  movePx: 8,
  lev0: 1,
  lev1: 2.2,
  wildSec: 90,
  /** The line never rises faster than this per point (a spike is a ramp, never a wall). */
  maxRise: 14,
  centerPull: 0.02,
  gravity: 980,
  /** Cruise speed the ground pulls the sled toward, ramping 180 → 300 px/s, then creeping. */
  cruise0: 180,
  cruise1: 300,
  cruiseGain: 2.5,
  rampSec: 60,
  creep: 0.4,
  /** Holding on the ground presses: extra push along the slope (px/s²). */
  press: 260,
  /** Release after holding at least `hopMinTicks` hops, charged up to `hopChargeTicks`. */
  hopMin: 240,
  hopMax: 460,
  hopMinTicks: 6,
  hopChargeTicks: 36,
  /** In the air, holding spins the sled (turns/s²); letting go settles it toward level. */
  spinAccel: 2.4,
  settle: 6,
  settleDamp: 3,
  /** A landing is clean within this fraction of a turn from level. */
  cleanTurn: 0.12,
  /** Gaps: none before `gapFromSec`; a chance per point (rising with the run), 2 → 6 points wide, far side lower. */
  gapFromSec: 10,
  gapChance0: 0.004,
  gapChance1: 0.012,
  gapW0: 2,
  gapW1: 6,
  gapDrop: 30,
  /** Falling this far below the band is a wipeout; so is no progress for `stallSec`. */
  fallPx: 80,
  stallSec: 6,
  stallSpeed: 20,
  maxSpeed: 900,
  /** Scoring: distance and airtime, times the combo; a flip is a bonus times the combo. */
  distRate: 0.1,
  airRate: 40,
  flipBonus: 500,
  comboStep: 0.5,
  comboDecaySec: 3,
  minFlightSec: 0.25,
} as const;
