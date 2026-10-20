"use client";

import { sfxBus } from "../audio";
import { SFX } from "./constants";

/**
 * The arcade's sounds (Mitoshi `features/games/arcade/arcade-sfx.ts`), synthesized on the games' effects bus rather
 * than played from files, all in A minor where the bed lives, under the effects slider and the first-gesture unlock.
 *
 * Candle Hop: a "tuiing" on every gap (a fast upward portamento on a triangle, a shimmer an octave up), a little
 * higher each gap of the streak, a fifth across forty gaps and then held; a crash of two detuned saws sliding down
 * under a closing filter with a thud. Line Rider: an airy rising sweep under a bloom as the line flows in; a tick as the
 * combo crosses a whole number; a soft blip back on the line; and the wipeout, a tumble down the scale.
 */
let noise: AudioBuffer | null = null;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** One oscillator with an attack and an exponential release. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  hz: number,
  at: number,
  dur: number,
  peak: number,
) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, at);
  env.gain.setValueAtTime(SFX.floor, at);
  env.gain.exponentialRampToValueAtTime(peak, at + SFX.attackSec);
  env.gain.exponentialRampToValueAtTime(SFX.floor, at + dur);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + dur + SFX.tailSec);
}

/** Filtered noise with a sweep: the whoosh of a takeoff, the exhale of a fall. */
function sweep(
  ctx: AudioContext,
  out: AudioNode,
  type: BiquadFilterType,
  sweepHz: { from: number; to: number },
  at: number,
  dur: number,
  peak: number,
) {
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  src.buffer = noiseBuffer(ctx);
  filter.type = type;
  filter.Q.value = SFX.sweepQ;
  filter.frequency.setValueAtTime(sweepHz.from, at);
  filter.frequency.exponentialRampToValueAtTime(sweepHz.to, at + dur * SFX.sweepGlide);
  env.gain.setValueAtTime(SFX.floor, at);
  env.gain.exponentialRampToValueAtTime(peak, at + dur * SFX.sweepRise);
  env.gain.exponentialRampToValueAtTime(SFX.floor, at + dur);
  src.connect(filter).connect(env).connect(out);
  src.start(at);
  src.stop(at + dur + SFX.noiseTailSec);
}

function thud(ctx: AudioContext, out: AudioNode, t: number, peak: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(SFX.thud.fromHz, t);
  osc.frequency.exponentialRampToValueAtTime(SFX.thud.toHz, t + SFX.thud.glideSec);
  env.gain.setValueAtTime(SFX.floor, t);
  env.gain.exponentialRampToValueAtTime(peak, t + SFX.thud.riseSec);
  env.gain.exponentialRampToValueAtTime(SFX.floor, t + SFX.thud.decaySec);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + SFX.thud.stopSec);
}

function safely(fn: (ctx: AudioContext, out: AudioNode, at: number) => void): void {
  const bus = sfxBus();
  if (!bus) return;
  try {
    fn(bus.ctx, bus.out, bus.ctx.currentTime);
  } catch {
    // Enhancement only: a cue that fails to build costs nothing.
  }
}

/** A gap cleared, the `streak`th in a row (0-based). */
export function hopScoreSfx(streak: number): void {
  safely((ctx, out, t) => {
    const s = SFX.hopScore;
    const climb = Math.min(streak, s.streakCap) / s.streakCap;
    const hz = s.baseHz * 2 ** (s.climbOctaves * climb);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(hz * s.scoopFrom, t);
    osc.frequency.exponentialRampToValueAtTime(hz, t + s.scoopSec);
    env.gain.setValueAtTime(SFX.floor, t);
    env.gain.exponentialRampToValueAtTime(s.peak, t + SFX.attackSec);
    env.gain.exponentialRampToValueAtTime(SFX.floor, t + s.decaySec);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + s.stopSec);
    tone(ctx, out, "sine", hz * 2, t + s.shimmerAtSec, s.shimmerSec, s.shimmerPeak);
  });
}

/** The hop's crash: two saws a fifth apart sliding down under a closing filter, and a thud beneath. */
export function hopCrashSfx(): void {
  safely((ctx, out, t) => {
    const c = SFX.hopCrash;
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(c.cutoffFromHz, t);
    filter.frequency.exponentialRampToValueAtTime(c.cutoffToHz, t + c.closeSec);
    env.gain.setValueAtTime(SFX.floor, t);
    env.gain.exponentialRampToValueAtTime(c.peak, t + c.riseSec);
    env.gain.exponentialRampToValueAtTime(SFX.floor, t + c.decaySec);
    filter.connect(env).connect(out);
    for (const voice of c.voices) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = voice.detune;
      osc.frequency.setValueAtTime(voice.hz, t);
      osc.frequency.exponentialRampToValueAtTime(voice.hz * c.slide, t + c.slideSec);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + c.stopSec);
    }
    thud(ctx, out, t, c.thudPeak);
  });
}

/** The line flows in: an airy rising sweep under a soft bloom up the chord. */
export function rideStartSfx(): void {
  safely((ctx, out, t) => {
    const r = SFX.rideStart;
    sweep(ctx, out, "bandpass", r.sweepHz, t, r.sweepSec, r.sweepPeak);
    r.bloomHz.forEach((hz, i) => {
      tone(ctx, out, "sine", hz, t + r.bloomLeadSec + i * r.bloomGapSec, r.bloomSec, r.bloomPeak);
    });
  });
}

/** The wipeout: the floor drops out under a tumble down the scale and an exhale through a closing filter. */
export function rideCrashSfx(): void {
  safely((ctx, out, t) => {
    const r = SFX.rideCrash;
    thud(ctx, out, t, r.thudPeak);
    r.tumbleHz.forEach((hz, i) => {
      tone(ctx, out, "sine", hz, t + r.tumbleLeadSec + i * r.tumbleGapSec, r.tumbleSec, r.tumblePeak);
    });
    sweep(ctx, out, "lowpass", r.sweepHz, t, r.sweepSec, r.sweepPeak);
  });
}

/** The combo crossed `mult`: a short bright tick, a semitone higher for each whole number, capped an octave up. */
export function milestoneSfx(mult: number): void {
  safely((ctx, out, t) => {
    const m = SFX.milestone;
    const steps = Math.min(m.maxSteps, Math.max(0, Math.floor(mult) - 2));
    const hz = m.baseHz * 2 ** (steps / m.maxSteps);
    tone(ctx, out, "square", hz, t, m.tickSec, m.tickPeak);
    tone(ctx, out, "sine", hz * 2, t + m.shimmerAtSec, m.shimmerSec, m.shimmerPeak);
  });
}

/** Back on the line: a soft, low blip, a haptic with a voice. */
export function regainSfx(): void {
  safely((ctx, out, t) => tone(ctx, out, "triangle", SFX.regain.hz, t, SFX.regain.sec, SFX.regain.peak));
}

/** The 3-2-1 beeps and the GO (Senryo `countBeep`/`countGo`): A5 for each count, an octave up for GO. */
export function countSfx(go: boolean): void {
  safely((ctx, out, t) => {
    const c = SFX.count;
    tone(ctx, out, "square", go ? c.goHz : c.beepHz, t, go ? c.goSec : c.beepSec, c.peak);
    if (go) tone(ctx, out, "triangle", c.goUnderHz, t + c.goUnderAtSec, c.goUnderSec, c.goUnderPeak);
  });
}
