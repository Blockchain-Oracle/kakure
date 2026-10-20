// Ported from Mitoshi `features/games/arcade/sled/sled-scene.ts` (Senryo's sled-run.ts): Line Rider v3's run. Each fixed step
// turns the held input into the sled's code, records it (the trace the server replays), steps the shared engine, and
// turns its events into the feel — sparks while pressing into the line, a puff on the hop, dust and a shake on a hard
// landing, a rising note per clean landing and per gap cleared, a flip's surge, and on the wipeout a shake, a flash and
// fragments. All of it view-only: the engine's state is never touched. Sounds are Mitoshi's synthesized arcade cues.
import {
  type ArcadeRunConfig,
  createRng,
  createSledState,
  type Rng,
  recordSledInput,
  SLED,
  type SledState,
  STEP_HZ,
  sledCode,
  sledOpenAt,
  sledScoreOf,
  stepSled,
} from "@kakure/arcade";
import type { SledInk } from "../ink";

export interface SledTape {
  feed: string;
  fromSec: number;
  toSec: number;
  moves: readonly number[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
}

/** Everything the draw reads: the engine's state, the step before it, and the view's own effects. */
export interface SledScene {
  s: SledState;
  prev: { bx: number; by: number; fx: number; fy: number; rx: number; ry: number };
  ink: SledInk;
  tape: SledTape;
  particles: Particle[];
  texts: FloatText[];
  trail: { x: number; y: number }[];
  shake: number;
  flash: number;
  camY: number;
  /** Reduced motion: no shake, flash or streaks. */
  still: boolean;
}

/** What the run tells the page, which turns it into sounds and haptics. */
export type SledCue =
  | { kind: "hop" }
  | { kind: "gap"; n: number }
  | { kind: "land"; hard: boolean }
  | { kind: "combo"; combo: number }
  | { kind: "flip"; n: number }
  | { kind: "milestone"; m: number }
  | { kind: "crash" };

const FX = {
  trail: 120,
  hitStopTicks: 2,
  hardLanding: 260,
  landAirSec: 0.15,
  landShake: 4,
  crashShake: 8,
  flipShake: 3,
  shakeKeep: 0.85,
  flashKeep: 0.9,
  scrapeSpeed: 120,
  gravity: 600,
  dust: 10,
  dustHard: 18,
  sparks: 2,
  crashBits: 28,
  flipBits: 16,
  textTicks: 54,
  textRise: 0.5,
  bitLife: 40,
  sparkLife: 18,
  sparkSpeed: 140,
  sparkLift: 0.5,
  dustSpeed: 90,
  burstSpeed: 260,
  bitSize: 3,
  sparkSize: 1.6,
  textLift: 30,
  textStack: 18,
  textStackTicks: 20,
} as const;

const AUTO = { look: 220, release: 40, every: 150, charge: 30 } as const;
const FLIP_WORDS: Readonly<Record<number, string>> = { 1: "FLIP", 2: "DOUBLE FLIP", 3: "TRIPLE FLIP" };
const rand = (spread: number) => (Math.random() * 2 - 1) * spread;

export interface SledInput {
  hold: boolean;
  lean: -1 | 0 | 1;
}

export interface SledRun {
  scene: SledScene;
  trace: number[];
  step(input: SledInput, cue: (c: SledCue) => void): void;
  autopilot(): SledInput;
  bestCombo(): number;
  gaps(): number;
}

export function createSledRun(o: {
  seed: string;
  calm: boolean;
  tape: SledTape;
  ink: SledInk;
  still: boolean;
}): SledRun {
  const rng: Rng = createRng(o.seed);
  const config: ArcadeRunConfig = { calm: o.calm, ...(o.tape.moves.length ? { moves: o.tape.moves } : {}) };
  const s = createSledState(rng, config);
  const trace: number[] = [];
  const scene: SledScene = {
    s,
    prev: { bx: s.b.x, by: s.b.y, fx: s.f.x, fy: s.f.y, rx: s.r.x, ry: s.r.y },
    ink: o.ink,
    tape: o.tape,
    particles: [],
    texts: [],
    trail: [],
    shake: 0,
    flash: 0,
    camY: 0,
    still: o.still,
  };
  let hitStop = 0;
  let airTicks = 0;
  let overGap = false;
  let gaps = 0;
  let bestCombo = 1;
  let lastFlips = 0;

  const burst = (x: number, y: number, n: number, speed: number, color: string, life: number, size: number) => {
    for (let i = 0; i < n; i++)
      scene.particles.push({ x, y, vx: rand(speed), vy: -Math.random() * speed, life, max: life, color, size });
  };
  const say = (text: string, color: string) => {
    const fresh = scene.texts.filter((t) => t.life > FX.textTicks - FX.textStackTicks).length;
    scene.texts.push({ text, x: s.r.x, y: s.r.y - FX.textLift - fresh * FX.textStack, life: FX.textTicks, color });
  };
  const tickFx = () => {
    scene.shake *= FX.shakeKeep;
    scene.flash *= FX.flashKeep;
    const dt = 1 / STEP_HZ;
    scene.particles = scene.particles.filter((q) => {
      q.vy += FX.gravity * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= 1;
      return q.life > 0;
    });
    scene.texts = scene.texts.filter((t) => {
      t.y -= FX.textRise;
      t.life -= 1;
      return t.life > 0;
    });
  };

  const step = (input: SledInput, cue: (c: SledCue) => void) => {
    if (s.over) return tickFx();
    if (hitStop > 0) {
      hitStop -= 1;
      return;
    }
    const pv = scene.prev;
    pv.bx = s.b.x;
    pv.by = s.b.y;
    pv.fx = s.f.x;
    pv.fy = s.f.y;
    pv.rx = s.r.x;
    pv.ry = s.r.y;
    const code = sledCode(input.hold, input.lean);
    const hopping = s.held && !input.hold && s.grounded && s.heldTicks >= SLED.hopMinTicks;
    const comboBefore = s.combo;
    recordSledInput(trace, s.tick, code);
    stepSled(s, code, rng, config);
    if (s.over) {
      if (!scene.still) {
        scene.shake = FX.crashShake;
        scene.flash = 1;
      }
      burst(s.r.x, s.r.y, FX.crashBits, FX.burstSpeed, o.ink.down, FX.bitLife, FX.bitSize);
      burst(s.r.x, s.r.y, FX.crashBits / 2, FX.burstSpeed, o.ink.ink, FX.bitLife, FX.bitSize);
      return cue({ kind: "crash" });
    }
    if (hopping) {
      cue({ kind: "hop" });
      burst(s.b.x, s.b.y, FX.dust, FX.dustSpeed, o.ink.ink, FX.sparkLife, FX.sparkSize);
    }
    if (!s.grounded) {
      airTicks += 1;
      if (sledOpenAt(s, (s.b.x + s.f.x) / 2)) overGap = true;
    }
    if (s.landed) {
      const air = airTicks / STEP_HZ;
      airTicks = 0;
      const mx = (s.b.x + s.f.x) / 2;
      const my = (s.b.y + s.f.y) / 2;
      if (overGap) {
        overGap = false;
        gaps += 1;
        cue({ kind: "gap", n: gaps });
        say("GAP CLEARED", o.ink.up);
      }
      if (air >= FX.landAirSec) {
        const hard = s.landed >= FX.hardLanding;
        if (hard) {
          hitStop = FX.hitStopTicks;
          if (!scene.still) scene.shake = Math.max(scene.shake, FX.landShake);
        }
        burst(mx, my, hard ? FX.dustHard : FX.dust, FX.dustSpeed, o.ink.ink, FX.bitLife, FX.bitSize);
        cue({ kind: "land", hard });
        if (s.combo > comboBefore) {
          bestCombo = Math.max(bestCombo, s.combo);
          cue({ kind: "combo", combo: s.combo });
          say(`CLEAN ×${s.combo}`, o.ink.range);
        }
      }
    }
    if (s.flipped) {
      const n = s.flips - lastFlips;
      say(FLIP_WORDS[n] ?? `${n}× FLIP`, o.ink.accent);
      cue({ kind: "flip", n });
      if (!scene.still) scene.shake = Math.max(scene.shake, FX.flipShake);
      burst(s.r.x, s.r.y, FX.flipBits, FX.burstSpeed, o.ink.accent, FX.bitLife, FX.bitSize);
    }
    lastFlips = s.flips;
    if (s.milestoneHit) {
      cue({ kind: "milestone", m: s.milestoneHit });
      say(`×${s.milestoneHit} COMBO`, o.ink.up);
    }
    // Pressing into the line throws sparks off the back runner.
    if (s.grounded && input.hold && s.speed > FX.scrapeSpeed) {
      for (let i = 0; i < FX.sparks; i++) {
        scene.particles.push({
          x: s.b.x,
          y: s.b.y,
          vx: -Math.random() * FX.sparkSpeed,
          vy: -Math.random() * FX.sparkSpeed * FX.sparkLift,
          life: FX.sparkLife,
          max: FX.sparkLife,
          color: o.ink.up,
          size: FX.sparkSize,
        });
      }
    }
    scene.trail.push({ x: s.b.x, y: s.b.y });
    if (scene.trail.length > FX.trail) scene.trail.shift();
    tickFx();
  };

  return {
    scene,
    trace,
    step,
    autopilot: () => {
      // Charge for a gap coming up and hop at its edge; otherwise a show hop now and then.
      const mid = (s.b.x + s.f.x) / 2;
      let gapAt = -1;
      for (let d = 0; d <= AUTO.look; d += SLED.seg) {
        if (sledOpenAt(s, mid + d)) {
          gapAt = d;
          break;
        }
      }
      if (!s.grounded) return { hold: false, lean: 0 };
      if (gapAt >= 0) return { hold: gapAt > AUTO.release, lean: 0 };
      return { hold: s.tick % AUTO.every < AUTO.charge, lean: 0 };
    },
    bestCombo: () => bestCombo,
    gaps: () => gaps,
  };
}

export { sledScoreOf };
