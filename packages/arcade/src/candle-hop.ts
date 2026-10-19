import { FIELD_H, FIELD_W, HOP, MAX_RUN_TICKS, STEP_HZ, STEP_SEC } from "./constants";
import { Rng } from "./rng";
import { moveAt, type Tape } from "./tape";

/** One candle pair: the coin must pass between `gapTop` and `gapBottom` (y grows down). */
export interface HopCandle {
  /** World x of the candle's centre. */
  x: number;
  gapTop: number;
  gapBottom: number;
  up: boolean;
  passed: boolean;
}

/** How far each normalised move shifts the gap centre (px), and how strongly it drifts back to the middle. */
const LEVEL_STEP_PX = 14;
const LEVEL_PULL = 0.04;
const HALF = 0.5;

/**
 * Candle Hop: a coin flies through a canyon of real 1-minute candles. Tap to hop; touching a body, the floor or
 * the ceiling ends the run. One point per candle passed. The gap narrows (120 → 88 px) and the scroll speeds up
 * (150 → 205 px/s) over the ramp; calm mode keeps a wider floor and a slower ramp.
 */
export class CandleHop {
  tick = 0;
  y = FIELD_H * HALF;
  vy = 0;
  score = 0;
  over = false;
  scroll = 0;
  readonly candles: HopCandle[] = [];
  private tapeIndex: number;
  private level = FIELD_H * HALF;
  private nextX: number = HOP.firstCandleX;
  private tapped = false;

  constructor(
    seed: number,
    private readonly tape: Tape,
    private readonly calm = false,
  ) {
    this.tapeIndex = tape.moves.length > 0 ? new Rng(seed).int(0, tape.moves.length - 1) : 0;
    this.fill();
  }

  /** A tap applies on the next step (several taps in one tick count once). */
  tap(): void {
    if (!this.over) this.tapped = true;
  }

  step(): void {
    if (this.over) return;
    if (this.tapped) {
      this.vy = HOP.tapSpeed;
      this.tapped = false;
    }
    this.vy = Math.min(HOP.maxFall, this.vy + HOP.gravity * STEP_SEC);
    this.y += this.vy * STEP_SEC;
    this.scroll += this.speed() * STEP_SEC;
    this.tick += 1;
    this.fill();
    this.collide();
    if (this.tick >= MAX_RUN_TICKS) this.over = true;
  }

  /** Seconds into the run, stretched in calm mode. */
  private progress(): number {
    const ramp = HOP.rampSec * (this.calm ? HOP.calmStretch : 1);
    return Math.min(1, this.tick / STEP_HZ / ramp);
  }

  private speed(): number {
    return HOP.speed0 + (HOP.speed1 - HOP.speed0) * this.progress();
  }

  private gap(): number {
    const floor = this.calm ? HOP.calmGap1 : HOP.gap1;
    return HOP.gap0 + (floor - HOP.gap0) * this.progress();
  }

  /** Lays candles until one spacing past the right edge; each takes the next tape move. */
  private fill(): void {
    while (this.nextX - this.scroll < FIELD_W + HOP.spacing) {
      const move = moveAt(this.tape, this.tapeIndex);
      const up = this.tape.up.length > 0 ? (this.tape.up[this.tapeIndex % this.tape.up.length] as boolean) : true;
      this.tapeIndex += 1;
      const gap = this.gap();
      const half = gap * HALF;
      this.level -= move * LEVEL_STEP_PX;
      this.level += (FIELD_H * HALF - this.level) * LEVEL_PULL;
      this.level = Math.min(FIELD_H - half - HOP.coinRadius, Math.max(half + HOP.coinRadius, this.level));
      this.candles.push({ x: this.nextX, gapTop: this.level - half, gapBottom: this.level + half, up, passed: false });
      this.nextX += HOP.spacing;
    }
    while ((this.candles[0]?.x ?? Number.POSITIVE_INFINITY) - this.scroll < -HOP.spacing) this.candles.shift();
  }

  private collide(): void {
    const r = HOP.coinRadius;
    if (this.y - r < 0 || this.y + r > FIELD_H) {
      this.over = true;
      return;
    }
    const coinX = this.scroll + HOP.coinX;
    const reach = HOP.bodyWidth * HALF + r;
    for (const candle of this.candles) {
      if (Math.abs(candle.x - coinX) < reach && (this.y - r < candle.gapTop || this.y + r > candle.gapBottom)) {
        this.over = true;
        return;
      }
      if (!candle.passed && candle.x + HOP.bodyWidth * HALF < coinX - r) {
        candle.passed = true;
        this.score += 1;
      }
    }
  }
}

/** Replays a run from its seed, tape and tap ticks (ascending). The score the server ranks. */
export function replayHop(seed: number, tape: Tape, taps: ReadonlyArray<number>, calm = false) {
  const game = new CandleHop(seed, tape, calm);
  let next = 0;
  while (!game.over) {
    while (next < taps.length && (taps[next] as number) <= game.tick) {
      game.tap();
      next += 1;
    }
    game.step();
  }
  return { score: game.score, ticks: game.tick };
}
