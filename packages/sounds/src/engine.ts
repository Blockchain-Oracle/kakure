import {
  CUES,
  type CueName,
  LADDER_SEMITONES,
  MASTER_GAIN,
  MS_PER_S,
  SEMITONES_PER_OCTAVE,
  SILENT_GAIN,
  type Voice,
} from "./constants";

/**
 * A tiny Web Audio synth for the cue map. The AudioContext is created on the first user gesture (browsers refuse
 * sound before one; that refusal is swallowed, kawase.md §9.1), resumed when the tab returns, and every failure is
 * silent: nothing here ever throws into a money flow.
 */
let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let volume = 1;

const NOISE_SECONDS = 1;
const SMOOTHING_S = 0.01;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  try {
    if (!context) {
      context = new AudioContext({ latencyHint: "interactive" });
      master = context.createGain();
      master.gain.value = MASTER_GAIN * volume;
      master.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** Call from a gesture handler (pointerdown/keydown) so the first cue is heard. */
export function unlockAudio(): void {
  ensureContext();
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  if (master && context) master.gain.setTargetAtTime(MASTER_GAIN * volume, context.currentTime, SMOOTHING_S);
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function playVoice(ctx: AudioContext, out: AudioNode, voice: Voice, mix: number, transpose: number) {
  const start = ctx.currentTime + (voice.atMs ?? 0) / MS_PER_S;
  const end = start + voice.ms / MS_PER_S;
  const peak = Math.max(SILENT_GAIN, voice.gain * mix);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(SILENT_GAIN, start);
  envelope.gain.exponentialRampToValueAtTime(peak, start + voice.attackMs / MS_PER_S);
  envelope.gain.exponentialRampToValueAtTime(SILENT_GAIN, end);
  envelope.connect(out);

  if (voice.wave === "noise") {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.connect(envelope);
    source.start(start);
    source.stop(end);
    return;
  }
  const oscillator = ctx.createOscillator();
  oscillator.type = voice.wave;
  oscillator.frequency.setValueAtTime(voice.hz * transpose, start);
  if (voice.toHz) oscillator.frequency.exponentialRampToValueAtTime(voice.toHz * transpose, end);
  oscillator.connect(envelope);
  oscillator.start(start);
  oscillator.stop(end);
}

/** Plays a cue; `step` transposes it up the pentatonic ladder (the profit cue). */
export function playCue(name: CueName, step = 0): void {
  const ctx = ensureContext();
  if (!ctx || !master || ctx.state !== "running") return;
  const semitones = LADDER_SEMITONES[Math.min(step, LADDER_SEMITONES.length - 1)] ?? 0;
  const transpose = 2 ** (semitones / SEMITONES_PER_OCTAVE);
  const cue = CUES[name];
  try {
    for (const voice of cue.voices) playVoice(ctx, master, voice, cue.mix, transpose);
  } catch {
    // A failed cue is never an error for the person.
  }
}
