/**
 * Cue definitions: pure data, synthesised live with Web Audio on the web and rendered to WAV for the phone later
 * (Senryo's pattern, senryo.md §6.5: "no audio file ships"). Each cue is a few voices: an oscillator (or noise) with
 * a pitch glide, a short attack and an exponential release, mixed to the cue's level.
 *
 * The palette follows Kawase (kawase.md §9): money cues in C major (a high C bell when money arrives, C–E–G when it
 * leaves, a C when a result is confirmed), short sine transients for the interface. Position reactions follow
 * Senryo (senryo.md §6.4): a major-pentatonic profit ladder over two octaves, a falling blip on adverse moves.
 * "No sound for ticks or navigation" (kawase.md §9.1); the network switch is the one interface cue.
 */

export type Wave = "sine" | "triangle" | "square" | "sawtooth" | "noise";

export interface Voice {
  wave: Wave;
  /** Start frequency in Hz (ignored for noise). */
  hz: number;
  /** End frequency for a glide; omitted = steady. */
  toHz?: number;
  /** When the voice starts, relative to the cue. */
  atMs?: number;
  /** Total length, attack included. */
  ms: number;
  attackMs: number;
  /** Peak level 0..1 before the cue mix. */
  gain: number;
}

/** Haptic words (kawase.md §9.5); the web maps them to vibration patterns where a device supports it. */
export type HapticWord = "tick" | "press" | "snap" | "confirm" | "filled" | "warn" | "fail" | "move" | "surge";

export interface Cue {
  voices: readonly Voice[];
  /** Level of the whole cue (Senryo's SOUND_MIX). */
  mix: number;
  haptic?: HapticWord;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;
const C4 = 261.63;
const G4 = 392;

export const CUES = {
  /** The network switch (Senryo's toggle: a 1,400 Hz sine for 30 ms over a 700 Hz triangle at 25 ms). */
  toggle: {
    voices: [
      { wave: "sine", hz: 1400, ms: 30, attackMs: 2, gain: 0.5 },
      { wave: "triangle", hz: 700, atMs: 25, ms: 60, attackMs: 3, gain: 0.45 },
    ],
    mix: 0.5,
    haptic: "snap",
  },
  /** A ticket was built and its QR shown (Kawase's `send`: the chord as money leaves). */
  send: {
    voices: [
      { wave: "triangle", hz: C5, ms: 420, attackMs: 4, gain: 0.5 },
      { wave: "triangle", hz: E5, atMs: 70, ms: 400, attackMs: 4, gain: 0.45 },
      { wave: "triangle", hz: G5, atMs: 140, ms: 520, attackMs: 4, gain: 0.45 },
    ],
    mix: 0.4,
    haptic: "press",
  },
  /** Money arrived: a payout or refund seen (Kawase's `received`: a high C bell). */
  received: {
    voices: [
      { wave: "sine", hz: C6, ms: 1100, attackMs: 3, gain: 0.6 },
      { wave: "sine", hz: C6 * 2, ms: 600, attackMs: 3, gain: 0.18 },
    ],
    mix: 0.4,
    haptic: "filled",
  },
  /** A result confirmed: a ticket counted, a market resolved (Kawase's `confirmed`: a C). */
  confirmed: {
    voices: [{ wave: "triangle", hz: C5, ms: 360, attackMs: 4, gain: 0.6 }],
    mix: 0.3,
    haptic: "confirm",
  },
  /** Odds released in a batch (the sealed panel flips). */
  batch: {
    voices: [
      { wave: "sine", hz: G5, ms: 140, attackMs: 3, gain: 0.5 },
      { wave: "sine", hz: C6, atMs: 90, ms: 260, attackMs: 3, gain: 0.5 },
    ],
    mix: 0.33,
    haptic: "tick",
  },
  error: {
    voices: [
      { wave: "triangle", hz: 330, toHz: 247, ms: 260, attackMs: 4, gain: 0.55 },
      { wave: "triangle", hz: 247, atMs: 150, ms: 260, attackMs: 4, gain: 0.45 },
    ],
    mix: 0.24,
    haptic: "fail",
  },
  /** One favourable step; transposed up the ladder (`LADDER_SEMITONES`). */
  profit: {
    voices: [
      { wave: "sine", hz: C5, ms: 160, attackMs: 3, gain: 0.55 },
      { wave: "triangle", hz: C5 * 2, ms: 90, attackMs: 2, gain: 0.15 },
    ],
    mix: 0.3,
    haptic: "move",
  },
  /** An adverse step (Senryo: sine 262 → 196 Hz, 110 ms, mixed at 0.07). */
  adverse: {
    voices: [{ wave: "sine", hz: C4, toHz: 196, ms: 110, attackMs: 4, gain: 1 }],
    mix: 0.07,
    haptic: "move",
  },
  /** A favourable surge (C5–E5–G5–C6 triangle arpeggio, 45 ms apart). */
  surge: {
    voices: [
      { wave: "triangle", hz: C5, ms: 140, attackMs: 3, gain: 0.5 },
      { wave: "triangle", hz: E5, atMs: 45, ms: 140, attackMs: 3, gain: 0.5 },
      { wave: "triangle", hz: G5, atMs: 90, ms: 140, attackMs: 3, gain: 0.5 },
      { wave: "triangle", hz: C6, atMs: 135, ms: 260, attackMs: 3, gain: 0.5 },
    ],
    mix: 0.28,
    haptic: "surge",
  },
  mega: {
    voices: [
      { wave: "triangle", hz: C5, ms: 140, attackMs: 3, gain: 0.5 },
      { wave: "triangle", hz: E5, atMs: 45, ms: 140, attackMs: 3, gain: 0.5 },
      { wave: "triangle", hz: G5, atMs: 90, ms: 140, attackMs: 3, gain: 0.5 },
      { wave: "triangle", hz: C6, atMs: 135, ms: 160, attackMs: 3, gain: 0.5 },
      { wave: "triangle", hz: E6, atMs: 180, ms: 320, attackMs: 3, gain: 0.5 },
    ],
    mix: 0.28,
    haptic: "surge",
  },
  /** An adverse surge (Senryo's slump: sine 330 → 130 Hz, 280 ms). */
  slump: {
    voices: [{ wave: "sine", hz: 330, toHz: 130, ms: 280, attackMs: 6, gain: 0.8 }],
    mix: 0.22,
    haptic: "warn",
  },
  /** The settled verdict on a position. */
  win: {
    voices: [
      { wave: "triangle", hz: G4, ms: 180, attackMs: 3, gain: 0.45 },
      { wave: "triangle", hz: C5, atMs: 110, ms: 200, attackMs: 3, gain: 0.5 },
      { wave: "sine", hz: E5, atMs: 220, ms: 260, attackMs: 3, gain: 0.5 },
      { wave: "sine", hz: C6, atMs: 330, ms: 700, attackMs: 3, gain: 0.5 },
    ],
    mix: 0.35,
    haptic: "filled",
  },
  loss: {
    voices: [
      { wave: "sine", hz: G4, ms: 220, attackMs: 4, gain: 0.5 },
      { wave: "sine", hz: 311.13, atMs: 160, ms: 420, attackMs: 4, gain: 0.5 },
    ],
    mix: 0.25,
    haptic: "warn",
  },
} as const satisfies Record<string, Cue>;

export type CueName = keyof typeof CUES;

/** Major pentatonic over two octaves (senryo.md §6.4, Owarine's COMBO_SEMITONES). */
export const LADDER_SEMITONES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] as const;

/** Master level under the user's volume (Senryo's SOUND_MASTER). */
export const MASTER_GAIN = 0.9;
export const SILENT_GAIN = 0.0001;
export const SEMITONES_PER_OCTAVE = 12;
export const MS_PER_S = 1000;

/** Web vibration patterns per haptic word (ms on/off). iOS Safari has no vibration API, so the web is Android-only. */
export const VIBRATION: Record<HapticWord, number | number[]> = {
  tick: 8,
  move: 8,
  press: 12,
  snap: [10, 30, 14],
  confirm: 18,
  filled: [14, 40, 22],
  warn: [24, 50, 24],
  fail: [30, 60, 30, 60, 30],
  surge: 40,
};

/**
 * The reaction engine's thresholds (senryo.md §6.4, from Tradash's spec): a step is a move of at least
 * max(2.5 × noise, 0.005 % of price), capped at 0.08 %; a surge is ≥ 0.025 % (mega 0.06 %) inside 1.5 s.
 */
export const REACTION = {
  emaAlpha: 0.03,
  stepNoiseFactor: 2.5,
  stepMinFraction: 0.00005,
  stepMaxFraction: 0.0008,
  surgeFraction: 0.00025,
  megaFraction: 0.0006,
  surgeWindowMs: 1500,
  cooldownMs: 3000,
  /** Steps share 160 ms buckets; the strongest wins (film-sound throttling). */
  bucketMs: 160,
  maxLadderStep: 10,
  /** The adverse blip plays from the second adverse step on. */
  adverseFrom: 2,
} as const;

/* ── The terminal's music (Owarine `lib/sound/music.ts`, sequenced in code on the Web Audio clock) ─────────────── */

export type MusicTrack = "arcade" | "rush" | "night";

export interface MusicTrackSpec {
  bpm: number;
  /** Chords a bar each: root MIDI and the third (3 minor, 4 major). */
  chords: ReadonlyArray<{ root: number; third: number }>;
  /** Lead per sixteenth as indexes into [root, third, fifth, octave]; null rests. */
  lead: ReadonlyArray<number | null>;
  leadType: OscillatorType;
  /** Bass per eighth, semitones above the root an octave down. */
  bass: readonly number[];
  /** Kit per sixteenth: k kick, s snare, h hat, . rest. */
  kit: string;
  gain: number;
}

export const MUSIC_TRACKS: Record<MusicTrack, MusicTrackSpec> = {
  arcade: {
    bpm: 112,
    chords: [
      { root: 57, third: 3 },
      { root: 53, third: 4 },
      { root: 48, third: 4 },
      { root: 55, third: 4 },
    ],
    lead: [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1],
    leadType: "square",
    bass: [0, 12, 0, 12, 0, 12, 7, 12],
    kit: "kh.hsh.hkh.hshhh",
    gain: 1,
  },
  rush: {
    bpm: 128,
    chords: [
      { root: 52, third: 3 },
      { root: 52, third: 3 },
      { root: 48, third: 4 },
      { root: 50, third: 4 },
    ],
    lead: [0, null, 2, null, 3, null, 2, 0, null, 2, null, 3, 2, null, 1, null],
    leadType: "sawtooth",
    bass: [0, 0, 12, 0, 0, 12, 0, 7],
    kit: "khshkhshkhshkhsh",
    gain: 0.85,
  },
  night: {
    bpm: 92,
    chords: [
      { root: 50, third: 3 },
      { root: 46, third: 4 },
      { root: 53, third: 4 },
      { root: 48, third: 4 },
    ],
    lead: [2, null, null, 1, null, null, 0, null, 3, null, null, 2, null, 1, null, null],
    leadType: "triangle",
    bass: [0, 0, 7, 0, 0, 12, 7, 0],
    kit: "k...s...k.k.s...",
    gain: 0.9,
  },
};

export const MUSIC_TRACK_NAMES: Record<MusicTrack, string> = { arcade: "Arcade", rush: "Rush", night: "Night" };

/** Gains, fades and the scheduler (Owarine's values). */
export const MUSIC = {
  masterGain: 0.32,
  fadeInSec: 1.2,
  crossfadeSec: 0.5,
  lookaheadSec: 0.1,
  tickMs: 25,
  startDelaySec: 0.05,
  stopTimeConstant: 0.1,
  sixteenthsPerBar: 16,
  stepsPerBeat: 4,
  secondsPerMinute: 60,
  a4Midi: 69,
  a4Hz: 440,
  octave: 12,
  fifth: 7,
  attackSec: 0.008,
  releaseAt: 0.7,
  releaseShare: 0.15,
  tailSec: 0.1,
  leadGain: 0.05,
  leadLength: 0.9,
  bassGain: 0.16,
  bassLength: 1.8,
  padGain: 0.025,
  padLength: 15,
  kick: { fromHz: 140, toHz: 45, sweepSec: 0.12, gain: 0.5, decaySec: 0.16, stopSec: 0.2 },
  snare: { hz: 1_800, lengthSec: 0.12, gain: 0.22 },
  hat: { hz: 7_000, lengthSec: 0.04, gain: 0.07 },
  noiseOffsetMax: 0.5,
  noiseTail: 0.02,
  silent: 0.001,
  /** The tense low-pass while a position is losing 5 % or more: 900 Hz over 1.5 s, back over 0.6 s. */
  tenseHz: 900,
  openHz: 20_000,
  tenseInSec: 1.5,
  tenseOutSec: 0.6,
  crossfadeDisconnectFactor: 2,
  crossfadeTimeConstants: 3,
  /** The pad holds the chord's root, third and fifth. */
  padVoices: 3,
} as const;
