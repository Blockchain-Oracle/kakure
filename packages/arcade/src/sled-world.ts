// Ported from Mitoshi (crypto-world-fair@0355c617) packages/core/src/games/arcade/sled-world.ts, Kakure's design authority for
// the arcade (plan §0 R4). The engine is unchanged; its tape comes from Kakure's signed prints files (`tape.ts`).
import { type ArcadeRunConfig, clamp, FIELD_H, lerp } from "./field";
import type { Rng } from "./rng";

/**
 * Line Rider's sled world (R7.2, D-318): the sled's tuning, its state, and the terrain — the price tape the server
 * issued (one move per recorded print, in tenths of a basis point, `ArcadeRunConfig.moves`) laid out as a line. A rising price climbs, a falling one drops;
 * the tape's own spikes become ramps and its drops cliffs. Normalisation is fixed for the run (the tape's mean move is
 * `movePx`) and the leverage grows as the run goes on, so terrain already laid never reshapes. A few seeded jumps keep
 * a calm tape playable, and after the warm-up the line opens in gaps — a gap down, its far side lower — that only a hop
 * clears. Only + − × ÷, min, max, abs, floor, round — the square root is `droot`.
 */
export const SLED = {
  /** Runner spacing and the rider's height above their midpoint (world px). */
  length: 34,
  riderHeight: 18,
  riderRadius: 6,
  /** Terrain points every `seg` px, kept `ahead` px past the sled and `behind` px before it. */
  seg: 24,
  ahead: 900,
  behind: 400,
  gravity: 980,
  /** Holding presses the runners down (grip on bumps) and pumps the cruise up. */
  pressGain: 0.5,
  pumpGain: 0.35,
  /** The hop on release, charged by how long you held (px/s up). */
  hopMin: 240,
  hopMax: 460,
  hopChargeTicks: 36,
  hopMinTicks: 6,
  /** Lean: a turn the rider puts into the triangle in the air (px/s² at the rider, opposite at the runners). */
  lean: 1700,
  /** With no lean held, the rider balances in the air: a turn back toward level and against the spin (px/s² per
   * unit of tilt, per rad/s). Leaning switches it off, so flips stay the player's. */
  levelGain: 900,
  levelDamp: 220,
  /** Air drag and ground friction per step (velocity kept). */
  airKeep: 0.9995,
  groundKeep: 0.9995,
  /** The cruise the line pulls the sled toward while grounded, ramping with the run: 180 → 300 px/s. */
  cruise0: 180,
  cruise1: 300,
  cruiseGain: 5,
  motorMax: 1100,
  motorMin: -500,
  rampSec: 60,
  /** Past the ramp the cruise keeps creeping (px/s per second): every run eventually breaks. */
  cruiseCreep: 0.4,
  /** A flight counts (combo, airtime) only this long and this far forward. */
  flightMinSec: 0.25,
  flightMinPx: 40,
  /** Speed is capped so a long fall never tunnels through the line. */
  maxSpeed: 900,
  passes: 6,
  /** A landing is clean when the sled meets the line within this tilt (|cross| of unit vectors). */
  cleanTilt: 0.35,
  /** The terrain's band on screen (y grows down). */
  yTop: 70,
  yBottom: 320,
  /** One tape move spreads over this many points; the tape's mean move is `movePx` at 1× leverage. */
  tapeSegs: 2,
  movePx: 8,
  /** A near-flat tape is not blown up past this mean move (tenths of a basis point). */
  moveFloor: 5,
  /** Leverage over `wildSec`: the same tape, steeper. */
  lev0: 1,
  lev1: 2.2,
  wildSec: 90,
  /** A little seeded texture, and seeded jumps that grow more often and bigger with the run. */
  walkDrift: 0.4,
  jump0: 0.01,
  jump1: 0.05,
  jumpSize0: 50,
  jumpSize1: 95,
  centerPull: 0.02,
  smooth: 0.35,
  /** The line never rises faster than this per point (px), so a spike is a ramp to ride, never a wall. */
  maxRise: 14,
  /** No forward progress for this long is a wipeout: every run ends. */
  stallSec: 6,
  /** Gaps: none before `gapFromSec`; a chance per point laid, 2 → 6 points wide, the far side `gapDrop` lower. */
  gapFromSec: 10,
  gap0: 0.004,
  gap1: 0.012,
  gapW0: 2,
  gapW1: 6,
  gapDrop: 30,
  gapCool: 40,
  /** A runner this far below the band fell into a gap; this far under the far edge, it hit the wall. */
  fallPx: 80,
  wallPx: 6,
  /** Reduced motion's calmer run: the ramps take this much longer. */
  calmStretch: 1.6,
  /** Scoring. */
  distRate: 0.1,
  airRate: 40,
  flipBonus: 500,
  comboStep: 0.5,
  comboDecaySec: 3,
} as const;

const NEWTON_STEPS = 24;
/** The opening is flat for this many sled lengths ahead of the start. */
const FLAT_SLEDS = 4;
/** The ground over a gap: nothing to land on. */
export const GAP_FLOOR = FIELD_H * 10;
export const HALF = 0.5;
/** A run with no tape lays the seed's own walk (a guest's run, or a deployment without an index). */
const NO_MOVES: readonly number[] = [];

/** √x by a fixed Newton iteration: + − × ÷ only, the same bits on V8, JSC and Hermes. */
export function droot(x: number): number {
  if (x <= 0) return 0;
  let g = x > 1 ? x : 1;
  for (let i = 0; i < NEWTON_STEPS; i++) g = HALF * (g + x / g);
  return g;
}

export interface SledPoint {
  x: number;
  y: number;
  px: number;
  py: number;
}

export interface SledState {
  tick: number;
  elapsedSec: number;
  over: boolean;
  /** Back runner, front runner, rider. */
  b: SledPoint;
  f: SledPoint;
  r: SledPoint;
  /** Terrain: y at world x = (head + i) × seg; `open[i]` when the segment after point i is a gap. */
  head: number;
  pts: number[];
  open: boolean[];
  /** Points laid so far, and the tape's minute the run starts at (the seed picks it); the gap being laid (segments
   * left), its near edge, the cool-down. */
  laid: number;
  tapeStart: number;
  gapLeft: number;
  gapEdge: number;
  gapCool: number;
  /** px per tape unit at 1× leverage, fixed for the run. */
  tapeScale: number;
  walk: number;
  walkSmooth: number;
  /** Ground contact this step (either runner), and the last step's. */
  grounded: boolean;
  wasGrounded: boolean;
  held: boolean;
  heldTicks: number;
  airSec: number;
  flightFromX: number;
  /** The sled's heading quadrant and the quarter turns made this flight (signed). */
  quadrant: number;
  quarters: number;
  flips: number;
  combo: number;
  comboSec: number;
  milestone: number;
  score: number;
  distance: number;
  /** Seconds since the sled last went further than ever. */
  stallSec: number;
  speed: number;
  /** Events of the last step, for the draw and the sounds. */
  landed: number;
  clean: boolean;
  flipped: boolean;
  milestoneHit: number;
  crashed: boolean;
}

/** How far into its ramps a run is (0–1), slower under reduced motion. */
export const rampOf = (s: SledState, sec: number, config: ArcadeRunConfig): number =>
  clamp(s.elapsedSec / (sec * (config.calm ? SLED.calmStretch : 1)), 0, 1);

/** The tape's minute under world x (it wraps on a long run), for the HUD's price and the floor's clock. */
export const tapeIndexAt = (s: SledState, x: number, tapeLength: number): number =>
  tapeLength === 0 ? 0 : (s.tapeStart + Math.floor(Math.max(0, x) / (SLED.seg * SLED.tapeSegs))) % tapeLength;

function tapeScaleOf(tape: readonly number[]): number {
  let sum = 0;
  for (const m of tape) sum += Math.abs(m);
  const mean = tape.length === 0 ? SLED.moveFloor : sum / tape.length;
  return SLED.movePx / Math.max(mean, SLED.moveFloor);
}

function walkNext(s: SledState, rng: Rng, config: ArcadeRunConfig): number {
  const d = rampOf(s, SLED.wildSec, config);
  const tape = config.moves ?? NO_MOVES;
  const move = tape.length === 0 ? 0 : (tape[tapeIndexAt(s, s.laid * SLED.seg, tape.length)] as number);
  // A rising price climbs: y grows down, so a move up lifts the line.
  let step = (-move * s.tapeScale * lerp(SLED.lev0, SLED.lev1, d)) / SLED.tapeSegs;
  step += SLED.walkDrift * (rng.next() * 2 - 1);
  if (rng.next() < lerp(SLED.jump0, SLED.jump1, d)) {
    step += (rng.next() < HALF ? -1 : 1) * lerp(SLED.jumpSize0, SLED.jumpSize1, d);
  }
  s.walk += step;
  // Keep the walk on screen: a soft pull back toward the middle of the band.
  const mid = (SLED.yTop + SLED.yBottom) * HALF;
  s.walk += (mid - s.walk) * SLED.centerPull;
  s.walkSmooth += (s.walk - s.walkSmooth) * SLED.smooth;
  // y grows down: a rise is the line's y falling, held to `maxRise` a point.
  const last = s.pts[s.pts.length - 1];
  if (last !== undefined && s.walkSmooth < last - SLED.maxRise) s.walkSmooth = last - SLED.maxRise;
  return clamp(s.walkSmooth, SLED.yTop, SLED.yBottom);
}

/** Lays one point (and whether the segment after it is open), opening and closing gaps. */
function layNext(s: SledState, rng: Rng, config: ArcadeRunConfig): void {
  let y = walkNext(s, rng, config);
  let open = false;
  if (s.gapLeft > 0) {
    open = true;
    s.gapLeft -= 1;
  } else if (s.gapCool > 0) {
    s.gapCool -= 1;
    // The far side of a gap that just closed sits lower than its near side.
    if (s.gapCool === SLED.gapCool - 1) {
      y = Math.min(SLED.yBottom, Math.max(y, s.gapEdge + SLED.gapDrop));
      s.walk = y;
      s.walkSmooth = y;
    }
  } else if (s.elapsedSec >= SLED.gapFromSec && y < SLED.yBottom - SLED.gapDrop) {
    const d = rampOf(s, SLED.wildSec, config);
    if (rng.next() < lerp(SLED.gap0, SLED.gap1, d)) {
      open = true;
      s.gapEdge = y;
      s.gapLeft = Math.round(lerp(SLED.gapW0, SLED.gapW1, rng.next() * d)) - 1;
      s.gapCool = SLED.gapCool;
    }
  }
  s.laid += 1;
  s.pts.push(y);
  s.open.push(open);
}

/** Lays terrain `ahead` of the front runner and drops what fell `behind` the back one. */
export function fillTerrain(s: SledState, rng: Rng, config: ArcadeRunConfig): void {
  const want = Math.floor((s.f.x + SLED.ahead) / SLED.seg) - s.head + 1;
  while (s.pts.length < want) layNext(s, rng, config);
  const drop = Math.floor((s.b.x - SLED.behind) / SLED.seg) - s.head;
  if (drop > 0) {
    s.pts.splice(0, drop);
    s.open.splice(0, drop);
    s.head += drop;
  }
}

/** Whether world x is over a gap. */
export function sledOpenAt(s: SledState, x: number): boolean {
  const i = Math.floor(x / SLED.seg - s.head);
  return i >= 0 && i < s.open.length && s.open[i] === true;
}

/** The line's y at world x (linear between points); over a gap, far below the field. */
export function sledGroundAt(s: SledState, x: number): number {
  if (sledOpenAt(s, x)) return GAP_FLOOR;
  const pos = x / SLED.seg - s.head;
  const i = Math.floor(pos);
  const last = s.pts.length - 1;
  if (i < 0) return s.pts[0] ?? FIELD_H;
  if (i >= last) return s.pts[last] ?? FIELD_H;
  const a = s.pts[i] as number;
  const b = s.pts[i + 1] as number;
  return a + (b - a) * (pos - i);
}

const point = (x: number, y: number): SledPoint => ({ x, y, px: x, py: y });

/** A sled at rest on a flat opening (no run begins with a free fall), the line laid ahead from the tape. */
export function createSledState(rng: Rng, config: ArcadeRunConfig): SledState {
  const startX = SLED.behind;
  const y0 = (SLED.yTop + SLED.yBottom) * HALF;
  const s: SledState = {
    tick: 0,
    elapsedSec: 0,
    over: false,
    b: point(startX, y0),
    f: point(startX + SLED.length, y0),
    r: point(startX + SLED.length * HALF, y0 - SLED.riderHeight),
    head: 0,
    pts: [],
    open: [],
    laid: 0,
    tapeStart: Math.floor(rng.next() * (config.moves ?? NO_MOVES).length),
    gapLeft: 0,
    gapEdge: 0,
    gapCool: 0,
    tapeScale: tapeScaleOf(config.moves ?? NO_MOVES),
    walk: y0,
    walkSmooth: y0,
    grounded: true,
    wasGrounded: true,
    held: false,
    heldTicks: 0,
    airSec: 0,
    flightFromX: startX,
    quadrant: 0,
    quarters: 0,
    flips: 0,
    combo: 1,
    comboSec: 0,
    milestone: 1,
    score: 0,
    distance: 0,
    stallSec: 0,
    speed: 0,
    landed: 0,
    clean: false,
    flipped: false,
    milestoneHit: 0,
    crashed: false,
  };
  const flatEnd = startX + SLED.length * FLAT_SLEDS;
  const count = Math.ceil((startX + SLED.ahead) / SLED.seg) + 1;
  for (let i = 0; i < count; i++) {
    if (i * SLED.seg < flatEnd) {
      s.pts.push(y0);
      s.open.push(false);
      s.laid += 1;
    } else layNext(s, rng, config);
  }
  return s;
}
