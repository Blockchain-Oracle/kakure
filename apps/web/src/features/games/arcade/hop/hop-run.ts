// Ported from Senryo:packages/arcade/src/flap-run.ts (R4-9, D-227) — Candle Hop v3's run on Mitoshi: a coin through the
// candle canyon. A press is a flap (recorded by tick for the replay); the coin squashes on the kick and stretches as it
// falls; each candle passed throws sparks; a crash is a short hit-stop, a shake, fragments and a flash. The 640×360
// canyon is letterboxed into the stage; candles are profit or loss by their print's move; the draw never steers the run.
import {
  type ArcadeRunConfig,
  createHopState,
  createRng,
  FIELD_H,
  FIELD_W,
  HOP,
  type HopCandle,
  type HopState,
  STEP_HZ,
  stepHop,
} from "@kakure/arcade";
import { type SledInk, tint } from "../ink";
import type { ArcadeView } from "../use-arcade-loop";

const LOOK = {
  bodyRadius: 4,
  coinGlow: 16,
  rim: 2,
  hitStopTicks: 3,
  crashShake: 8,
  shakeKeep: 0.86,
  flashKeep: 0.9,
  flashAlpha: 0.35,
  flashFloor: 0.02,
  squash: 0.28,
  stretchPerSpeed: 0.0006,
  stretchMax: 0.25,
  squashKeep: 0.8,
  gravity: 900,
  bits: 26,
  sparks: 10,
  bitLife: 40,
  sparkLife: 22,
  burst: 240,
  sparkSpeed: 160,
  bitSize: 3,
  sparkSize: 2,
} as const;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
/** The autopilot aims a little under the gap's middle and doesn't flap while already rising this fast. */
const AUTO_BIAS = 6;
const AUTO_RISE = -50;

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export type HopCue = "flap" | "score" | "crash";

const rand = (spread: number) => (Math.random() * 2 - 1) * spread;

function drawCandle(ctx: CanvasRenderingContext2D, c: HopCandle, x: number, ink: SledInk): void {
  const color = c.up ? ink.up : ink.down;
  const top = c.center - c.half;
  const bottom = c.center + c.half;
  const bw = HOP.bodyW;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - bw * HALF, -LOOK.bodyRadius, bw, top + LOOK.bodyRadius, LOOK.bodyRadius);
  ctx.roundRect(x - bw * HALF, bottom, bw, FIELD_H - bottom + LOOK.bodyRadius, LOOK.bodyRadius);
  ctx.fill();
  ctx.fillStyle = tint(ink.arena, HALF);
  ctx.fillRect(x + bw * HALF - LOOK.rim * 2, 0, LOOK.rim * 2, top);
  ctx.fillRect(x + bw * HALF - LOOK.rim * 2, bottom, LOOK.rim * 2, FIELD_H - bottom);
  // The wicks poke into the gap, lit.
  ctx.shadowBlur = LOOK.coinGlow * HALF;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.fillRect(x - HOP.wickW * HALF, top, HOP.wickW, c.wickTop);
  ctx.fillRect(x - HOP.wickW * HALF, bottom - c.wickBottom, HOP.wickW, c.wickBottom);
  ctx.shadowBlur = 0;
}

export interface HopRun {
  s: HopState;
  trace: number[];
  step(press: boolean, cue: (c: HopCue) => void): void;
  draw(view: ArcadeView, alpha: number): void;
  autopilot(): boolean;
}

export function createHopRun(o: {
  seed: string;
  calm: boolean;
  moves: readonly number[];
  ink: SledInk;
  still: boolean;
}): HopRun {
  const rng = createRng(o.seed);
  const config: ArcadeRunConfig = { calm: o.calm, ...(o.moves.length ? { moves: o.moves } : {}) };
  const s = createHopState(rng, config);
  const ink = o.ink;
  const trace: number[] = [];
  let shake = 0;
  let flash = 0;
  let hitStop = 0;
  let squash = 0;
  let bits: Bit[] = [];
  const burst = (x: number, y: number, n: number, speed: number, color: string, life: number, size: number) => {
    for (let i = 0; i < n; i++) bits.push({ x, y, vx: rand(speed), vy: rand(speed), life, max: life, color, size });
  };

  return {
    s,
    trace,
    step(press, cue) {
      shake *= LOOK.shakeKeep;
      flash *= LOOK.flashKeep;
      squash *= LOOK.squashKeep;
      const dt = 1 / STEP_HZ;
      bits = bits.filter((b) => {
        b.vy += LOOK.gravity * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= 1;
        return b.life > 0;
      });
      if (s.over) return;
      if (hitStop > 0) {
        hitStop -= 1;
        return;
      }
      if (press) trace.push(s.tick);
      stepHop(s, press, rng, config);
      if (s.flapped) {
        squash = 1;
        cue("flap");
      }
      if (s.scored) {
        cue("score");
        burst(HOP.coinX, s.coinY, LOOK.sparks, LOOK.sparkSpeed, ink.up, LOOK.sparkLife, LOOK.sparkSize);
      }
      if (s.crashed && s.impact) {
        hitStop = LOOK.hitStopTicks;
        shake = o.still ? 0 : LOOK.crashShake * s.impact.strength;
        flash = o.still ? 0 : 1;
        burst(HOP.coinX, s.coinY, LOOK.bits, LOOK.burst, ink.accent, LOOK.bitLife, LOOK.bitSize);
        burst(s.impact.x, s.impact.y, LOOK.sparks, LOOK.burst, ink.ink, LOOK.bitLife, LOOK.bitSize);
        cue("crash");
      }
    },
    draw(view, alpha) {
      const { ctx, w, h, dpr } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = ink.arena;
      ctx.fillRect(0, 0, w, h);
      const k = Math.min(w / FIELD_W, h / FIELD_H);
      const ox = (w - FIELD_W * k) * HALF + rand(shake);
      const oy = (h - FIELD_H * k) * HALF + rand(shake);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
      const sky = ctx.createLinearGradient(0, 0, 0, FIELD_H);
      sky.addColorStop(0, ink.raised);
      sky.addColorStop(1, ink.arena);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      const shift = (s.worldX - s.worldXPrev) * (1 - alpha);
      for (const c of s.candles) drawCandle(ctx, c, c.x + shift, ink);
      // The coin: squashed by a kick, stretched by a fall.
      const y = s.coinYPrev + (s.coinY - s.coinYPrev) * alpha;
      const x = HOP.coinX + s.coinOffsetXPrev + (s.coinOffsetX - s.coinOffsetXPrev) * alpha;
      const stretch = Math.min(LOOK.stretchMax, Math.max(0, s.vy) * LOOK.stretchPerSpeed) - squash * LOOK.squash;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 - stretch * HALF, 1 + stretch);
      ctx.shadowBlur = LOOK.coinGlow;
      ctx.shadowColor = ink.accent;
      ctx.fillStyle = s.dying ? ink.down : ink.accent;
      ctx.beginPath();
      ctx.arc(0, 0, HOP.coinR, 0, FULL_TURN);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = tint(ink.ink, HALF);
      ctx.lineWidth = LOOK.rim;
      ctx.beginPath();
      ctx.arc(0, 0, HOP.coinR - LOOK.rim * 2, 0, FULL_TURN);
      ctx.stroke();
      ctx.restore();
      for (const b of bits) {
        ctx.fillStyle = tint(b.color, b.life / b.max);
        ctx.fillRect(b.x - b.size * HALF, b.y - b.size * HALF, b.size, b.size);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (flash > LOOK.flashFloor) {
        ctx.fillStyle = tint(ink.down, flash * LOOK.flashAlpha);
        ctx.fillRect(0, 0, w, h);
      }
    },
    autopilot() {
      // Aim for the middle of the next gap (between its wicks); flap when below it and not already rising.
      const next = s.candles.find((c) => c.x + HOP.bodyW * HALF > HOP.coinX - HOP.hitR);
      const target = next ? next.center + (next.wickTop - next.wickBottom) * HALF + AUTO_BIAS : FIELD_H * HALF;
      return s.coinY > target && s.vy > AUTO_RISE;
    },
  };
}
