import { MS_PER_S, MUSIC, MUSIC_TRACKS, type MusicTrack, type MusicTrackSpec } from "./constants";
import { audioOutput } from "./engine";

/**
 * The terminal's music (Owarine `lib/sound/music.ts`, Tradash's behaviour): three looped tracks at 0.32 gain with a
 * 1.2 s fade-in and a 0.5 s crossfade between tracks, silent while the tab is hidden, and a "tense" low-pass while the
 * open position is down 5 % or more. The tracks are sequenced in code on the Web Audio clock: a look-ahead timer
 * books every note in the next 100 ms at its exact time, so a busy main thread can't smear the beat. It plays through
 * the app's master gain, so the sound switch and volume govern it too.
 */
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let trackBus: GainNode | null = null;
let current: MusicTrack | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextAt = 0;
let noise: AudioBuffer | null = null;
let wanted: { on: boolean; track: MusicTrack } = { on: false, track: "arcade" };
let bound = false;

const midiHz = (n: number) => MUSIC.a4Hz * 2 ** ((n - MUSIC.a4Midi) / MUSIC.octave);

function graph(): { ctx: AudioContext } | null {
  const o = audioOutput();
  if (!o) return null;
  if (!master || master.context !== o.ctx) {
    master = o.ctx.createGain();
    master.gain.value = 0;
    filter = o.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = MUSIC.openHz;
    master.connect(filter).connect(o.out);
    noise = o.ctx.createBuffer(1, o.ctx.sampleRate, o.ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return { ctx: o.ctx };
}

function note(
  ctx: AudioContext,
  to: AudioNode,
  type: OscillatorType,
  hz: number,
  at: number,
  dur: number,
  gain: number,
) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = hz;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + MUSIC.attackSec);
  env.gain.setTargetAtTime(0, at + dur * MUSIC.releaseAt, dur * MUSIC.releaseShare);
  osc.connect(env).connect(to);
  osc.start(at);
  osc.stop(at + dur + MUSIC.tailSec);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}

function hit(ctx: AudioContext, to: AudioNode, kind: string, at: number) {
  if (kind === "k") {
    const k = MUSIC.kick;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.setValueAtTime(k.fromHz, at);
    osc.frequency.exponentialRampToValueAtTime(k.toHz, at + k.sweepSec);
    env.gain.setValueAtTime(k.gain, at);
    env.gain.exponentialRampToValueAtTime(MUSIC.silent, at + k.decaySec);
    osc.connect(env).connect(to);
    osc.start(at);
    osc.stop(at + k.stopSec);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
    return;
  }
  if (!noise) return;
  const voice = kind === "s" ? MUSIC.snare : MUSIC.hat;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = kind === "s" ? "bandpass" : "highpass";
  bp.frequency.value = voice.hz;
  const env = ctx.createGain();
  env.gain.setValueAtTime(voice.gain, at);
  env.gain.exponentialRampToValueAtTime(MUSIC.silent, at + voice.lengthSec);
  src.connect(bp).connect(env).connect(to);
  src.start(at, Math.random() * MUSIC.noiseOffsetMax, voice.lengthSec + MUSIC.noiseTail);
  src.onended = () => {
    src.disconnect();
    bp.disconnect();
    env.disconnect();
  };
}

function schedule(ctx: AudioContext, bus: GainNode, t: MusicTrackSpec) {
  const stepSec = MUSIC.secondsPerMinute / t.bpm / MUSIC.stepsPerBeat;
  while (nextAt < ctx.currentTime + MUSIC.lookaheadSec) {
    const bar = Math.floor(step / MUSIC.sixteenthsPerBar) % t.chords.length;
    const s = step % MUSIC.sixteenthsPerBar;
    const chord = t.chords[bar] ?? { root: 0, third: 0 };
    const tones = [chord.root, chord.root + chord.third, chord.root + MUSIC.fifth, chord.root + MUSIC.octave];
    const lead = t.lead[s];
    if (lead !== null && lead !== undefined) {
      const tone = tones[lead] ?? chord.root;
      note(
        ctx,
        bus,
        t.leadType,
        midiHz(tone + MUSIC.octave),
        nextAt,
        stepSec * MUSIC.leadLength,
        MUSIC.leadGain * t.gain,
      );
    }
    if (s % 2 === 0) {
      const bass = chord.root - MUSIC.octave + (t.bass[s / 2] ?? 0);
      note(ctx, bus, "triangle", midiHz(bass), nextAt, stepSec * MUSIC.bassLength, MUSIC.bassGain * t.gain);
    }
    if (s === 0) {
      for (const n of tones.slice(0, MUSIC.padVoices))
        note(ctx, bus, "sine", midiHz(n), nextAt, stepSec * MUSIC.padLength, MUSIC.padGain * t.gain);
    }
    const k = t.kit[s];
    if (k && k !== ".") hit(ctx, bus, k, nextAt);
    nextAt += stepSec;
    step += 1;
  }
}

function play(track: MusicTrack) {
  const g = graph();
  if (!g || !master) return;
  const { ctx } = g;
  const now = ctx.currentTime;
  if (current && trackBus) {
    const old = trackBus;
    old.gain.setTargetAtTime(0, now, MUSIC.crossfadeSec / MUSIC.crossfadeTimeConstants);
    setTimeout(() => old.disconnect(), MUSIC.crossfadeSec * MUSIC.crossfadeDisconnectFactor * MS_PER_S);
  } else {
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(MUSIC.masterGain, now + MUSIC.fadeInSec);
  }
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, now);
  bus.gain.linearRampToValueAtTime(1, now + (current ? MUSIC.crossfadeSec : MUSIC.startDelaySec));
  bus.connect(master);
  trackBus = bus;
  current = track;
  step = 0;
  nextAt = now + MUSIC.startDelaySec;
  if (timer) clearInterval(timer);
  timer = setInterval(() => schedule(ctx, bus, MUSIC_TRACKS[track]), MUSIC.tickMs);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  const o = audioOutput();
  if (master && o) {
    master.gain.cancelScheduledValues(o.ctx.currentTime);
    master.gain.setTargetAtTime(0, o.ctx.currentTime, MUSIC.stopTimeConstant);
  }
  current = null;
}

function apply() {
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  if (!wanted.on || hidden) {
    stop();
    return;
  }
  if (current !== wanted.track || !timer) play(wanted.track);
}

/** On or off and which track; plays once a gesture has unlocked audio. */
export function setMusic(on: boolean, track: MusicTrack): void {
  wanted = { on, track };
  if (!bound && typeof document !== "undefined") {
    bound = true;
    document.addEventListener("visibilitychange", apply);
    for (const e of ["pointerup", "keydown", "touchend"]) {
      window.addEventListener(
        e,
        () => {
          if (wanted.on && !timer) apply();
        },
        { passive: true },
      );
    }
  }
  apply();
}

/** The tense low-pass while the open position is losing 5 % or more. */
export function setMusicTense(tense: boolean): void {
  const o = audioOutput();
  if (!filter || !o) return;
  const now = o.ctx.currentTime;
  filter.frequency.cancelScheduledValues(now);
  filter.frequency.setValueAtTime(filter.frequency.value, now);
  filter.frequency.exponentialRampToValueAtTime(
    tense ? MUSIC.tenseHz : MUSIC.openHz,
    now + (tense ? MUSIC.tenseInSec : MUSIC.tenseOutSec),
  );
}
