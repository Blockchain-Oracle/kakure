// Ported from Mitoshi (crypto-world-fair@0355c617) packages/core/src/games/arcade/sled.ts, Kakure's design authority for
// the arcade (plan §0 R4). The engine is unchanged; its tape comes from Kakure's signed prints files (`tape.ts`).
import { type ArcadeRunConfig, clamp, lerp, STEP_SEC } from "./field";
import type { Rng } from "./rng";
import {
  droot,
  fillTerrain,
  HALF,
  type SledPoint as P,
  rampOf,
  SLED,
  type SledState,
  sledGroundAt,
  sledOpenAt,
} from "./sled-world";

/**
 * Line Rider v2 — a sled riding the price line (R7.2, D-318, research 10 §3). The line is terrain laid from the
 * server's price tape (`sled-world.ts`): its spikes become ramps and its drops cliffs. The sled is two runners and a
 * rider held in a rigid triangle (Verlet: positions and last positions, six constraint passes a step), under gravity,
 * sliding on the line with friction. Hold to press into the line (more grip and speed down a slope), let go to hop, lean back or
 * forward to rotate in the air. Clean landings build the combo, full flips pay, airtime pays; the rider touching the
 * line, landing upside down, falling into a gap or hitting its far wall is a wipeout.
 *
 * Deterministic on every engine (field.ts): only + − × ÷, min, max, abs, floor, round — the square root is a fixed
 * Newton iteration (`droot`), never `Math.sqrt` (the spec lets engines approximate it). A run is its seed and the
 * input codes by tick; the server replays it to the same score.
 */
/** v3 on Mitoshi (R4-9, D-227): the sled replaces the pip-on-a-line of v1/v2 — its own board. */
export const SLED_ENGINE_VERSION = 3;

/** One byte a tick in the trace: bit 0 hold (press in), bits 1–2 lean (0 none, 1 back, 2 forward). */
export const SLED_HOLD = 1;
export const SLED_LEAN_BACK = 2;
export const SLED_LEAN_FORWARD = 4;
/** The highest code a trace can carry (both lean bits set reads as back). */
export const SLED_CODE_MAX = SLED_HOLD | SLED_LEAN_BACK | SLED_LEAN_FORWARD;
export const sledCode = (hold: boolean, lean: -1 | 0 | 1): number =>
  (hold ? SLED_HOLD : 0) | (lean < 0 ? SLED_LEAN_BACK : lean > 0 ? SLED_LEAN_FORWARD : 0);

const QUARTERS_PER_FLIP = 4;
const QUADRANT = { right: 0, down: 1, left: 2, up: 3 } as const;
const RIDER_EDGE = droot(SLED.length * HALF * (SLED.length * HALF) + SLED.riderHeight * SLED.riderHeight);

function integrate(p: P, ax: number, ay: number, keep: number): void {
  const dt2 = STEP_SEC * STEP_SEC;
  let vx = (p.x - p.px) * keep;
  let vy = (p.y - p.py) * keep;
  const v = droot(vx * vx + vy * vy) / STEP_SEC;
  if (v > SLED.maxSpeed) {
    const k = SLED.maxSpeed / v;
    vx *= k;
    vy *= k;
  }
  p.px = p.x;
  p.py = p.y;
  p.x += vx + ax * dt2;
  p.y += vy + ay * dt2;
}

function stick(a: P, b: P, rest: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = droot(dx * dx + dy * dy);
  if (d === 0) return;
  const k = ((d - rest) / d) * HALF;
  a.x += dx * k;
  a.y += dy * k;
  b.x -= dx * k;
  b.y -= dy * k;
}

/** A runner on the line: lifted to the surface, its fall into the line removed, its slide kept less friction. */
function collide(s: SledState, p: P): boolean {
  const g = sledGroundAt(s, p.x);
  if (p.y < g) return false;
  // The line's tangent (unit) from its neighbours; at a gap's edge, the edge's own height (no tangent into the drop).
  const xl = p.x - SLED.seg * HALF;
  const xr = p.x + SLED.seg * HALF;
  const gl = sledOpenAt(s, xl) ? g : sledGroundAt(s, xl);
  const gr = sledOpenAt(s, xr) ? g : sledGroundAt(s, xr);
  const tx0 = SLED.seg;
  const ty0 = gr - gl;
  const tl = droot(tx0 * tx0 + ty0 * ty0);
  const tx = tx0 / tl;
  const ty = ty0 / tl;
  const vx = p.x - p.px;
  const vy = p.y - p.py;
  const along = vx * tx + vy * ty;
  p.y = g;
  p.px = p.x - along * tx * SLED.groundKeep;
  p.py = p.y - along * ty * SLED.groundKeep;
  return true;
}

/** Which way the runner line points, as a quadrant 0–3 (right, down, left, up in screen terms). */
function quadrantOf(s: SledState): number {
  const dx = s.f.x - s.b.x;
  const dy = s.f.y - s.b.y;
  if (dx >= 0 && dy >= 0) return QUADRANT.right;
  if (dx < 0 && dy >= 0) return QUADRANT.down;
  if (dx < 0 && dy < 0) return QUADRANT.left;
  return QUADRANT.up;
}

/** One 60 Hz step with input `code` (`sledCode`). Mutates in place; a finished run ignores further steps. */
export function stepSled(s: SledState, code: number, rng: Rng, config: ArcadeRunConfig): void {
  if (s.over) return;
  s.tick += 1;
  s.elapsedSec += STEP_SEC;
  s.landed = 0;
  s.clean = false;
  s.flipped = false;
  s.milestoneHit = 0;
  const hold = (code & SLED_HOLD) !== 0;
  const bOverGap = sledOpenAt(s, s.b.x);
  const fOverGap = sledOpenAt(s, s.f.x);
  const lean = (code & SLED_LEAN_BACK) !== 0 ? -1 : (code & SLED_LEAN_FORWARD) !== 0 ? 1 : 0;

  // The runner line's unit direction and its normal (pointing from the runners to the rider's side).
  const lx0 = s.f.x - s.b.x;
  const ly0 = s.f.y - s.b.y;
  const ll = droot(lx0 * lx0 + ly0 * ly0) || 1;
  const ux = lx0 / ll;
  const uy = ly0 / ll;
  const nx = uy;
  const ny = -ux;

  // Forces: gravity (pressed harder while holding), the cruise motor along the line while grounded — it pulls the
  // sled's speed along the line toward the cruise (higher while pumping) — and, in the air, lean as a turn.
  const ramp = rampOf(s, SLED.rampSec, config);
  const rampEnd = SLED.rampSec * (config.calm ? SLED.calmStretch : 1);
  const creep = Math.max(0, s.elapsedSec - rampEnd) * SLED.cruiseCreep;
  const cruise = (lerp(SLED.cruise0, SLED.cruise1, ramp) + creep) * (hold ? 1 + SLED.pumpGain : 1);
  const along = (((s.b.x - s.b.px + s.f.x - s.f.px) * ux + (s.b.y - s.b.py + s.f.y - s.f.py) * uy) * HALF) / STEP_SEC;
  const push = s.wasGrounded ? clamp((cruise - along) * SLED.cruiseGain, SLED.motorMin, SLED.motorMax) : 0;
  const g = SLED.gravity * (hold && s.wasGrounded ? 1 + SLED.pressGain : 1);
  const turn = s.wasGrounded ? 0 : lean !== 0 ? lean * SLED.lean : balance(s, ux, uy);
  const keep = s.wasGrounded ? SLED.groundKeep : SLED.airKeep;
  // Lean forward (turn > 0) dips the nose — a front flip: the tail rises, the nose drops, the rider pitches ahead.
  integrate(s.b, ux * push + nx * turn * HALF, g + uy * push + ny * turn * HALF, keep);
  integrate(s.f, ux * push - nx * turn * HALF, g + uy * push - ny * turn * HALF, keep);
  integrate(s.r, ux * push + ux * turn, g + uy * push + uy * turn, keep);

  fillTerrain(s, rng, config);
  // Into a gap and below the band, or out of one into its far wall: a wipeout.
  const floor = SLED.yBottom + SLED.fallPx;
  if (s.b.y > floor || s.f.y > floor || hitWall(s, s.b, bOverGap) || hitWall(s, s.f, fOverGap)) {
    crash(s);
    return;
  }
  let grounded = false;
  for (let i = 0; i < SLED.passes; i++) {
    stick(s.b, s.f, SLED.length);
    stick(s.b, s.r, RIDER_EDGE);
    stick(s.f, s.r, RIDER_EDGE);
    const hb = collide(s, s.b);
    const hf = collide(s, s.f);
    grounded = grounded || hb || hf;
  }

  // The rider touching the line is a wipeout.
  if (s.r.y >= sledGroundAt(s, s.r.x) - SLED.riderRadius) {
    crash(s);
    return;
  }

  // The hop: letting go after a hold on the line kicks the sled up off it — the longer the hold, the higher. After the
  // contact passes, so the line doesn't take the kick back this step.
  if (s.held && !hold && grounded && s.heldTicks >= SLED.hopMinTicks) {
    const charge = clamp(s.heldTicks / SLED.hopChargeTicks, 0, 1);
    const k = lerp(SLED.hopMin, SLED.hopMax, charge) * STEP_SEC;
    // Up, and forward where the board points downhill — never back down an uphill.
    for (const p of [s.b, s.f, s.r]) {
      p.px -= Math.max(0, nx) * k;
      p.py += k;
    }
  }
  s.heldTicks = hold && grounded ? s.heldTicks + 1 : 0;
  s.held = hold;

  // Flight: count quarter turns; on landing, judge it.
  const q = quadrantOf(s);
  if (!grounded && s.wasGrounded) s.flightFromX = (s.b.x + s.f.x) * HALF;
  if (!grounded) {
    const d = (q - s.quadrant + QUARTERS_PER_FLIP) % QUARTERS_PER_FLIP;
    if (d === 1) s.quarters += 1;
    else if (d === QUARTERS_PER_FLIP - 1) s.quarters -= 1;
    s.airSec += STEP_SEC;
  }
  s.quadrant = q;
  if (grounded && !s.wasGrounded) {
    // Upside down on landing (the rider below the runner line) is a wipeout.
    const riderSide = (s.r.x - s.b.x) * (s.f.y - s.b.y) - (s.r.y - s.b.y) * (s.f.x - s.b.x);
    if (riderSide < 0) {
      crash(s);
      return;
    }
    const gx = SLED.seg;
    const gy = sledGroundAt(s, s.f.x) - sledGroundAt(s, s.b.x);
    const gl = droot(gx * gx + gy * gy) || 1;
    const tilt = Math.abs((ux * gy - uy * gx) / gl);
    const vy = (s.b.y - s.b.py + s.f.y - s.f.py) * HALF;
    s.landed = Math.abs(vy) / STEP_SEC;
    s.clean = tilt <= SLED.cleanTilt;
    // Only a real flight counts: long enough and forward enough (a hop in place pays nothing).
    const flight = s.airSec >= SLED.flightMinSec && (s.b.x + s.f.x) * HALF - s.flightFromX >= SLED.flightMinPx;
    const flips = Math.floor(Math.abs(s.quarters) / QUARTERS_PER_FLIP);
    if (flight && flips > 0) {
      s.flips += flips;
      s.flipped = true;
      s.score += flips * SLED.flipBonus * s.combo;
    }
    if (flight) s.score += s.airSec * SLED.airRate * s.combo;
    if (flight && s.clean) {
      s.combo += SLED.comboStep;
      s.comboSec = 0;
    }
    s.quarters = 0;
    s.airSec = 0;
  }
  if (grounded) {
    s.comboSec += STEP_SEC;
    if (s.comboSec > SLED.comboDecaySec && s.combo > 1) {
      s.combo = Math.max(1, s.combo - SLED.comboStep);
      s.comboSec = 0;
    }
  }
  s.wasGrounded = grounded;
  s.grounded = grounded;

  // Distance pays as you go; the combo crossing a whole number is a milestone.
  const x = (s.b.x + s.f.x) * HALF;
  const vx = (s.b.x - s.b.px + s.f.x - s.f.px) * HALF;
  const vy = (s.b.y - s.b.py + s.f.y - s.f.py) * HALF;
  s.speed = droot(vx * vx + vy * vy) / STEP_SEC;
  if (x - SLED.behind > s.distance) {
    s.score += (x - SLED.behind - s.distance) * SLED.distRate * s.combo;
    s.distance = x - SLED.behind;
    s.stallSec = 0;
  } else {
    s.stallSec += STEP_SEC;
    if (s.stallSec >= SLED.stallSec) {
      crash(s);
      return;
    }
  }
  const whole = Math.floor(s.combo);
  if (whole > s.milestone) {
    s.milestone = whole;
    s.milestoneHit = whole;
  } else if (s.combo < s.milestone) s.milestone = Math.max(1, whole);
}

/**
 * The rider's balance in the air with no lean held: a turn toward level (only while the sled is the right way up) and
 * against the spin, whose rate is the cross product of the runner line's last and current directions.
 */
function balance(s: SledState, ux: number, uy: number): number {
  const lx = s.f.px - s.b.px;
  const ly = s.f.py - s.b.py;
  const ll = droot(lx * lx + ly * ly) || 1;
  const spin = ((lx / ll) * uy - (ly / ll) * ux) / STEP_SEC;
  const level = ux > 0 ? uy * SLED.levelGain : 0;
  return -(level + spin * SLED.levelDamp);
}

/** A runner that was over a gap and is now under the far side's surface hit its wall. */
function hitWall(s: SledState, p: P, wasOverGap: boolean): boolean {
  return wasOverGap && !sledOpenAt(s, p.x) && p.y - sledGroundAt(s, p.x) > SLED.wallPx;
}

function crash(s: SledState): void {
  s.crashed = true;
  s.over = true;
}

/** The integer a run is scored as, on the HUD and on the board. */
export const sledScoreOf = (s: SledState): number => Math.round(s.score);
