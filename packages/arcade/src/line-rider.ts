import { BAND_BOTTOM, BAND_TOP, FIELD_W, MAX_RUN_TICKS, RIDE, STEP_HZ, STEP_SEC } from "./constants";
import { Rng } from "./rng";
import { moveAt, type Tape } from "./tape";

/** One terrain point; `hole` points are gaps in the line. */
export interface RidePoint {
  x: number;
  y: number;
  hole: boolean;
}

const HALF = 0.5;
/** Points kept behind the sled for drawing. */
const KEEP_BEHIND_PX = 400;
/** After a gap, this many points before the next one may open. */
const GAP_COOLDOWN_POINTS = 40;
const CENTER = (BAND_TOP + BAND_BOTTOM) * HALF;

/**
 * Line Rider: a sled rides a line drawn from a real day of 1-minute moves. Hold to press (it pumps speed), release
 * to hop (charged by how long you held), hold in the air to spin. Land within `cleanTurn` of level for a clean
 * landing (the combo grows, full turns score as flips); land crooked, fall into a gap or stall, and the run ends.
 */
export class LineRider {
  tick = 0;
  x = RIDE.seg * 2;
  y = CENTER;
  vx: number = RIDE.cruise0;
  vy = 0;
  grounded = true;
  /** Rotation in turns (1 = a full flip); level is any whole number. */
  spin = 0;
  spinVel = 0;
  combo = 1;
  score = 0;
  flips = 0;
  over = false;
  readonly points: RidePoint[] = [];
  private holding = false;
  private holdTicks = 0;
  private airTicks = 0;
  private comboTimer = 0;
  private stallTimer = 0;
  private tapeIndex: number;
  private readonly rng: Rng;
  private gapLeft = 0;
  private cooldown = GAP_COOLDOWN_POINTS;

  constructor(
    seed: number,
    private readonly tape: Tape,
  ) {
    this.rng = new Rng(seed);
    this.tapeIndex = tape.moves.length > 0 ? this.rng.int(0, tape.moves.length - 1) : 0;
    this.points.push({ x: 0, y: CENTER, hole: false });
    this.extend();
    this.y = this.groundAt(this.x)?.y ?? CENTER;
  }

  press(): void {
    this.holding = true;
  }

  release(): void {
    this.holding = false;
  }

  step(): void {
    if (this.over) return;
    const startX = this.x;
    if (this.grounded) this.ride();
    else this.fly();
    this.tick += 1;
    this.score += Math.max(0, this.x - startX) * RIDE.distRate * this.combo;
    this.extend();
    if (this.tick >= MAX_RUN_TICKS) this.over = true;
  }

  /** The ground under `x`: its height and unit tangent, or `null` over a gap or off the laid line. */
  groundAt(x: number): { y: number; tx: number; ty: number } | null {
    const i = Math.floor(x / RIDE.seg);
    const a = this.pointAt(i);
    const b = this.pointAt(i + 1);
    if (!a || !b || a.hole || b.hole) return null;
    const f = (x - a.x) / RIDE.seg;
    const dy = b.y - a.y;
    const len = Math.sqrt(RIDE.seg * RIDE.seg + dy * dy);
    return { y: a.y + dy * f, tx: RIDE.seg / len, ty: dy / len };
  }

  private pointAt(i: number): RidePoint | undefined {
    const first = this.points[0];
    return first ? this.points[i - Math.round(first.x / RIDE.seg)] : undefined;
  }

  private cruise(): number {
    const t = this.tick / STEP_HZ;
    const ramp = Math.min(1, t / RIDE.rampSec);
    return RIDE.cruise0 + (RIDE.cruise1 - RIDE.cruise0) * ramp + Math.max(0, t - RIDE.rampSec) * RIDE.creep;
  }

  private ride(): void {
    const ground = this.groundAt(this.x);
    if (!ground) {
      this.grounded = false;
      return;
    }
    if (!this.holding && this.holdTicks >= RIDE.hopMinTicks) {
      this.hop(ground);
      return;
    }
    this.holdTicks = this.holding ? this.holdTicks + 1 : 0;
    let speed = this.vx * ground.tx + this.vy * ground.ty;
    const accel =
      RIDE.gravity * ground.ty + (this.cruise() - speed) * RIDE.cruiseGain + (this.holding ? RIDE.press : 0);
    speed = Math.min(RIDE.maxSpeed, Math.max(0, speed + accel * STEP_SEC));
    this.x += speed * ground.tx * STEP_SEC;
    const next = this.groundAt(this.x);
    if (!next) {
      this.vx = speed * ground.tx;
      this.vy = speed * ground.ty;
      this.grounded = false;
      return;
    }
    this.y = next.y;
    this.vx = speed * next.tx;
    this.vy = speed * next.ty;
    this.comboTimer += STEP_SEC;
    if (this.comboTimer > RIDE.comboDecaySec) this.combo = 1;
    this.stallTimer = speed < RIDE.stallSpeed ? this.stallTimer + STEP_SEC : 0;
    if (this.stallTimer > RIDE.stallSec) this.over = true;
  }

  private hop(ground: { tx: number; ty: number }): void {
    const charge = Math.min(1, (this.holdTicks - RIDE.hopMinTicks) / (RIDE.hopChargeTicks - RIDE.hopMinTicks));
    const lift = RIDE.hopMin + (RIDE.hopMax - RIDE.hopMin) * charge;
    // The upward normal of a tangent (tx, ty) in screen space (y down) is (ty, −tx).
    this.vx += ground.ty * lift;
    this.vy -= ground.tx * lift;
    this.holdTicks = 0;
    this.grounded = false;
    this.airTicks = 0;
  }

  private fly(): void {
    this.vy += RIDE.gravity * STEP_SEC;
    this.x += this.vx * STEP_SEC;
    this.y += this.vy * STEP_SEC;
    this.airTicks += 1;
    this.score += STEP_SEC * RIDE.airRate * this.combo;
    if (this.holding) {
      this.spinVel += RIDE.spinAccel * STEP_SEC;
    } else {
      const off = this.spin - Math.round(this.spin);
      this.spinVel += (-RIDE.settle * off - RIDE.settleDamp * this.spinVel) * STEP_SEC;
    }
    this.spin += this.spinVel * STEP_SEC;
    if (this.y > BAND_BOTTOM + RIDE.fallPx) {
      this.over = true;
      return;
    }
    const ground = this.groundAt(this.x);
    if (ground && this.y >= ground.y) this.land(ground.y);
  }

  private land(groundY: number): void {
    const turns = Math.round(this.spin);
    if (Math.abs(this.spin - turns) > RIDE.cleanTurn) {
      this.over = true;
      return;
    }
    this.y = groundY;
    this.grounded = true;
    if (this.airTicks / STEP_HZ >= RIDE.minFlightSec) {
      this.combo += RIDE.comboStep;
      this.comboTimer = 0;
    }
    const flips = Math.abs(turns);
    this.flips += flips;
    this.score += flips * RIDE.flipBonus * this.combo;
    this.spin = 0;
    this.spinVel = 0;
    this.holdTicks = 0;
  }

  /** Lays the line from the tape until well past the sled, and drops what is far behind. */
  private extend(): void {
    while ((this.points.at(-1)?.x ?? 0) < this.x + FIELD_W * 2) {
      const last = this.points.at(-1) as RidePoint;
      const index = this.points.length;
      const x = last.x + RIDE.seg;
      const lev = RIDE.lev0 + (RIDE.lev1 - RIDE.lev0) * Math.min(1, x / (RIDE.cruise0 * RIDE.wildSec));
      if (index % RIDE.segsPerMove === 0) this.tapeIndex += 1;
      const move = moveAt(this.tape, this.tapeIndex) / RIDE.segsPerMove;
      let y = last.y - move * RIDE.movePx * lev;
      y = Math.max(y, last.y - RIDE.maxRise);
      y += (CENTER - y) * RIDE.centerPull;
      let hole = false;
      if (this.gapLeft > 0) {
        hole = true;
        this.gapLeft -= 1;
        if (this.gapLeft === 0) y += RIDE.gapDrop;
      } else if (x > RIDE.cruise0 * RIDE.gapFromSec && this.cooldown <= 0) {
        const progress = Math.min(1, x / (RIDE.cruise0 * RIDE.wildSec));
        if (this.rng.next() < RIDE.gapChance0 + (RIDE.gapChance1 - RIDE.gapChance0) * progress) {
          this.gapLeft = this.rng.int(RIDE.gapW0, RIDE.gapW1);
          this.cooldown = GAP_COOLDOWN_POINTS;
        }
      }
      this.cooldown -= 1;
      y = Math.min(BAND_BOTTOM, Math.max(BAND_TOP, y));
      this.points.push({ x, y, hole });
    }
    while ((this.points[1]?.x ?? Number.POSITIVE_INFINITY) < this.x - KEEP_BEHIND_PX) this.points.shift();
  }
}

/** A hold toggle at a tick: `true` = pressed, `false` = released. */
export type RideInput = readonly [tick: number, down: boolean];

/** Replays a run from its seed, tape and input trace (ascending ticks). The score the server ranks. */
export function replayRide(seed: number, tape: Tape, inputs: ReadonlyArray<RideInput>) {
  const game = new LineRider(seed, tape);
  let next = 0;
  while (!game.over) {
    while (next < inputs.length && (inputs[next] as RideInput)[0] <= game.tick) {
      if ((inputs[next] as RideInput)[1]) game.press();
      else game.release();
      next += 1;
    }
    game.step();
  }
  return { score: Math.floor(game.score), flips: game.flips, ticks: game.tick };
}
