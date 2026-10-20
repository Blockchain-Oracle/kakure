"use client";

import { sfxBus } from "../audio";
import { REEL_SFX as R } from "./constants";

/**
 * The reels' voices (Mitoshi `lucky/reel-sfx.ts`, from Owarine): built from oscillators and filtered noise on the
 * games' effects bus (Kenney's set has no reel, and a sampled click reads as a button, not a machine). A spin-up sweep,
 * the ratchet, a landing per reel climbing a chord, and a confirm when the machine commits.
 */
let noiseBuffer: AudioBuffer | null = null;

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * R.noiseSec);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/** A rounded mallet: a triangle under a low-pass with a faint, slightly sharp octave shimmer. */
function bell(ctx: AudioContext, out: AudioNode, hz: number, at: number, durSec: number, gain: number) {
  const body = ctx.createOscillator();
  const shimmer = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  const shimmerGain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  body.type = "triangle";
  shimmer.type = "sine";
  body.frequency.setValueAtTime(hz, at);
  shimmer.frequency.setValueAtTime(hz * R.shimmerRatio, at);
  filter.type = "lowpass";
  filter.frequency.value = Math.min(hz * R.cutoffRatio, R.cutoffMaxHz);
  bodyGain.gain.setValueAtTime(R.floor, at);
  bodyGain.gain.exponentialRampToValueAtTime(gain, at + R.attackSec);
  bodyGain.gain.exponentialRampToValueAtTime(R.floor, at + durSec);
  shimmerGain.gain.setValueAtTime(R.floor, at);
  shimmerGain.gain.exponentialRampToValueAtTime(gain * R.shimmerGain, at + R.shimmerAttackSec);
  shimmerGain.gain.exponentialRampToValueAtTime(R.floor, at + durSec * R.shimmerLength);
  body.connect(filter).connect(bodyGain).connect(out);
  shimmer.connect(shimmerGain).connect(out);
  body.start(at);
  shimmer.start(at);
  body.stop(at + durSec + R.tailSec);
  shimmer.stop(at + durSec + R.tailSec);
}

function burst(ctx: AudioContext, out: AudioNode, at: number, shape: (f: BiquadFilterNode, g: GainNode) => number) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noise(ctx);
  const stopSec = shape(filter, gain);
  source.connect(filter).connect(gain).connect(out);
  source.start(at);
  source.stop(at + stopSec);
}

function withBus(play: (ctx: AudioContext, out: AudioNode, at: number) => void) {
  const bus = sfxBus();
  if (!bus) return;
  try {
    play(bus.ctx, bus.out, bus.ctx.currentTime);
  } catch {
    // Enhancement only.
  }
}

/** The reels take off: a band-passed sweep upward under a quick major triad. */
export function reelSpin(): void {
  withBus((ctx, out, at) => {
    const s = R.spin;
    burst(ctx, out, at, (filter, gain) => {
      filter.type = "bandpass";
      filter.Q.value = s.q;
      filter.frequency.setValueAtTime(s.fromHz, at);
      filter.frequency.exponentialRampToValueAtTime(s.toHz, at + s.glideSec);
      gain.gain.setValueAtTime(R.floor, at);
      gain.gain.exponentialRampToValueAtTime(s.peak, at + s.riseSec);
      gain.gain.exponentialRampToValueAtTime(R.floor, at + s.decaySec);
      return s.stopSec;
    });
    for (const note of R.spinChord) bell(ctx, out, note.hz, at + note.at, note.sec, note.gain);
  });
}

/** One detent of the ratchet: a hair of band-passed noise, its centre jittered so a stream reads as a rolling reel. */
export function reelTick(): void {
  withBus((ctx, out, at) => {
    const t = R.tick;
    burst(ctx, out, at, (filter, gain) => {
      filter.type = "bandpass";
      filter.Q.value = t.q;
      filter.frequency.value = t.baseHz + Math.random() * t.spreadHz;
      gain.gain.setValueAtTime(R.floor, at);
      gain.gain.exponentialRampToValueAtTime(t.peak, at + t.riseSec);
      gain.gain.exponentialRampToValueAtTime(R.floor, at + t.decaySec);
      return t.stopSec;
    });
  });
}

/** A reel lands: a body thunk, a detent click and a mallet one note higher per reel; the last one rings. */
export function reelLock(step: number, last: boolean): void {
  withBus((ctx, out, at) => {
    const k = R.thunk;
    const thunk = ctx.createOscillator();
    const thunkGain = ctx.createGain();
    thunk.type = "sine";
    thunk.frequency.setValueAtTime(k.fromHz, at);
    thunk.frequency.exponentialRampToValueAtTime(k.toHz, at + k.glideSec);
    thunkGain.gain.setValueAtTime(R.floor, at);
    thunkGain.gain.exponentialRampToValueAtTime(k.peak, at + k.riseSec);
    thunkGain.gain.exponentialRampToValueAtTime(R.floor, at + k.decaySec);
    thunk.connect(thunkGain).connect(out);
    thunk.start(at);
    thunk.stop(at + k.stopSec);
    const c = R.click;
    burst(ctx, out, at, (filter, gain) => {
      filter.type = "highpass";
      filter.frequency.value = c.hz;
      gain.gain.setValueAtTime(R.floor, at);
      gain.gain.exponentialRampToValueAtTime(c.peak, at + c.riseSec);
      gain.gain.exponentialRampToValueAtTime(R.floor, at + c.decaySec);
      return c.stopSec;
    });
    const l = R.lock;
    const note = R.lockNotes[Math.min(step, R.lockNotes.length - 1)] ?? R.lockNotes[0];
    bell(ctx, out, note, at + l.at, last ? l.lastSec : l.sec, l.gain);
    if (last) bell(ctx, out, l.sparkleHz, at + l.sparkleAt, l.sparkleSec, l.sparkleGain);
  });
}

/** The machine commits to its Window: a bright ascending confirm, clear of the reel chord. */
export function reelPick(): void {
  withBus((ctx, out, at) => {
    for (const note of R.pick) bell(ctx, out, note.hz, at + note.at, note.sec, note.gain);
  });
}
