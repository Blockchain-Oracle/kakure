import {
  A4_HZ,
  A4_MIDI,
  BED,
  BED_ARP,
  BED_BASS,
  BED_CHORDS,
  BED_KIT,
  BED_MOTIF,
  HAT,
  KICK,
  NOISE_TAIL_SEC,
  SEMITONES,
  SILENT,
  SNARE,
} from "./constants";

/**
 * The music bed, sequenced in code rather than played from a file (Mitoshi `features/games/bed.ts`): an eight-bar
 * chiptune loop in A minor, a pulse lead, a triangle bass, a filtered pad and a three-piece kit, at a tempo under the
 * swipe rather than driving it. It weighs nothing, loops without a seam, and its provenance is this file.
 *
 * Scheduling is the standard look-ahead: a short timer wakes every 25 ms and books every note that starts in the next
 * 100 ms at its exact sample time, so a busy main thread can't smear the beat.
 */
const STEP_SEC = 60 / BED.bpm / BED.beatsPerBar;
const STEPS = BED.bars * BED.stepsPerBar;
const ARP_SLOTS = 4;
const EIGHTH = 2;
const CHORD_COUNT = BED_CHORDS.length;
const midiHz = (note: number): number => A4_HZ * 2 ** ((note - A4_MIDI) / SEMITONES);

export interface ChipBed {
  start(): void;
  stop(): void;
}

type Hit = "k" | "s" | "h" | "H";
const isHit = (beat: string | undefined): beat is Hit => beat === "k" || beat === "s" || beat === "h" || beat === "H";

export function createChipBed(ctx: AudioContext, out: AudioNode): ChipBed {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(out);

  const leadFilter = ctx.createBiquadFilter();
  leadFilter.type = "lowpass";
  leadFilter.frequency.value = BED.leadCutoffHz;
  leadFilter.connect(master);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = BED.padCutoffHz;
  padFilter.connect(master);

  // A second of white noise, made once, for the snare and the hat.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  let timer: ReturnType<typeof setInterval> | null = null;
  let step = 0;
  let nextAt = 0;

  function tone(type: OscillatorType, hz: number, at: number, dur: number, gain: number, to: AudioNode, detune = 0) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    osc.detune.value = detune;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + BED.attackSec);
    env.gain.setTargetAtTime(0, at + dur * BED.releaseAt, dur * BED.releaseShape);
    osc.connect(env).connect(to);
    osc.start(at);
    osc.stop(at + dur + BED.tailSec);
  }

  function hit(at: number, kind: Hit) {
    if (kind === "k") {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(KICK.fromHz, at);
      osc.frequency.exponentialRampToValueAtTime(KICK.toHz, at + KICK.glideSec);
      env.gain.setValueAtTime(KICK.peak, at);
      env.gain.exponentialRampToValueAtTime(SILENT, at + KICK.decaySec);
      osc.connect(env).connect(master);
      osc.start(at);
      osc.stop(at + KICK.stopSec);
      return;
    }
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = noise;
    const snare = kind === "s";
    filter.type = snare ? "bandpass" : "highpass";
    filter.frequency.value = snare ? SNARE.hz : HAT.hz;
    const peak = snare ? SNARE.peak : kind === "H" ? HAT.accent : HAT.peak;
    const dur = snare ? SNARE.decaySec : HAT.decaySec;
    env.gain.setValueAtTime(peak, at);
    env.gain.exponentialRampToValueAtTime(SILENT, at + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(at);
    src.stop(at + dur + NOISE_TAIL_SEC);
  }

  function book(index: number, at: number) {
    const bar = Math.floor(index / BED.stepsPerBar);
    const sixteenth = index % BED.stepsPerBar;
    const chord = BED_CHORDS[bar % CHORD_COUNT] ?? { root: 0, third: 0 };
    const up = chord.root + BED.leadOctaveUp;
    const tones = [up, up + chord.third, chord.root + BED.arpFifth, chord.root + BED.arpOctave];

    // The lead: an arpeggio for four bars, the motif for four, a square under a low-pass.
    const pick = (bar < BED.motifFromBar ? BED_ARP : BED_MOTIF)[sixteenth];
    const note = pick === null || pick === undefined ? undefined : tones[pick % ARP_SLOTS];
    if (note !== undefined) tone("square", midiHz(note), at, STEP_SEC * BED.leadLength, BED.leadGain, leadFilter);

    // The bass on eighths: the octave bounce every chiptune walks.
    const bass = sixteenth % EIGHTH === 0 ? BED_BASS[sixteenth / EIGHTH] : undefined;
    if (bass !== undefined) {
      tone(
        "triangle",
        midiHz(chord.root - BED.bassOctaveDown + bass),
        at,
        STEP_SEC * BED.bassLength,
        BED.bassGain,
        master,
      );
    }

    // The pad: a bar-long chord from two detuned saws, quiet and dark.
    if (sixteenth === 0) {
      for (const padNote of [chord.root, chord.root + chord.third, chord.root + BED.padFifth]) {
        const length = STEP_SEC * BED.stepsPerBar;
        tone("sawtooth", midiHz(padNote), at, length, BED.padGain, padFilter, -BED.padDetuneCents);
        tone("sawtooth", midiHz(padNote), at, length, BED.padGain, padFilter, BED.padDetuneCents);
      }
    }

    const beat = BED_KIT[sixteenth];
    if (isHit(beat)) hit(at, beat);
    // A fill into the turnaround: sixteenth hats across the last beat of bar eight.
    else if (bar === BED.fillBar && sixteenth >= BED.fillFromStep) hit(at, "h");
  }

  function schedule() {
    while (nextAt < ctx.currentTime + BED.lookaheadSec) {
      book(step, nextAt);
      nextAt += STEP_SEC;
      step = (step + 1) % STEPS;
    }
  }

  return {
    start() {
      if (timer) return;
      nextAt = Math.max(nextAt, ctx.currentTime + BED.startLeadSec);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(1, ctx.currentTime, BED.fadeInSec);
      timer = setInterval(schedule, BED.tickMs);
      schedule();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, BED.fadeOutSec);
    },
  };
}
