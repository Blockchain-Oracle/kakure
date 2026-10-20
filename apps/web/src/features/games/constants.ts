/**
 * The games' tuning, in one place (Mitoshi `features/games/{audio,bed,feedback,motion}.ts`, by value): the effects and
 * music levels, Pips's press profile, the chiptune bed's score and voices, the vibration lengths and the stages' motion
 * presets. Nothing here is a rule of the market; every figure is how a game sounds, buzzes or moves.
 */

// ── Audio (Mitoshi audio.ts) ──

/** The sliders multiply these tuned levels: "100%" is the designed balance, not full amplitude. */
export const SFX_VOLUME_BASE = 0.6;
export const BGM_VOLUME_BASE = 0.3;
/** Pips: a press shorter than this still sounds this long, so a tap never clips its own release. */
export const PRESS_FLOOR_MS = 120;
/**
 * Pips's control profile: how far a press may detune, how far from the last press it must land (two identical clicks
 * in a row read as a loop), and the gain and low-pass cut it may take. A release reuses its press's variation, quieter.
 */
export const PRESS = {
  centsRange: 60,
  minCentsChange: 18,
  gainLo: 0.7,
  gainHi: 1,
  cutoffLoHz: 2_400,
  cutoffHiHz: 6_000,
  releaseGain: 0.55,
} as const;
export const CENTS_PER_OCTAVE = 1_200;
/** A running context is live audio to iOS (the speaker stays in the Dynamic Island): it sleeps this long after a sound. */
export const SLEEP_AFTER_MS = 2_500;
/** The volume sliders' step. */
export const VOLUME_STEP = 0.05;

// ── The music bed (Mitoshi bed.ts): an eight-bar chiptune loop in A minor ──

export const BED = {
  bpm: 112,
  bars: 8,
  stepsPerBar: 16,
  beatsPerBar: 4,
  lookaheadSec: 0.1,
  tickMs: 25,
  startLeadSec: 0.05,
  fadeInSec: 0.4,
  fadeOutSec: 0.15,
  leadCutoffHz: 3_200,
  padCutoffHz: 900,
  attackSec: 0.008,
  releaseAt: 0.8,
  releaseShape: 0.12,
  tailSec: 0.05,
  leadGain: 0.07,
  leadLength: 0.9,
  leadOctaveUp: 12,
  bassGain: 0.22,
  bassLength: 1.8,
  bassOctaveDown: 12,
  padGain: 0.028,
  padDetuneCents: 6,
  padFifth: 7,
  arpFifth: 19,
  arpOctave: 24,
  motifFromBar: 4,
  fillBar: 7,
  fillFromStep: 12,
} as const;

/** The four chords a bar each, twice: A minor, F, C, G, as MIDI roots with the third in semitones. */
export const BED_CHORDS: ReadonlyArray<{ root: number; third: number }> = [
  { root: 57, third: 3 },
  { root: 53, third: 4 },
  { root: 48, third: 4 },
  { root: 55, third: 4 },
];
/** A bar of arpeggio as indexes into [root, third, fifth, octave]; the loop's second half answers with a motif. */
export const BED_ARP: ReadonlyArray<number | null> = [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1];
export const BED_MOTIF: ReadonlyArray<number | null> = [
  3,
  null,
  2,
  null,
  1,
  2,
  null,
  3,
  null,
  null,
  2,
  1,
  0,
  null,
  1,
  null,
];
/** A bar of bass, as semitones above the root an octave down, on the eighths. */
export const BED_BASS: readonly number[] = [0, 12, 0, 12, 0, 12, 7, 12];
/** The kit per sixteenth: k kick, s snare, h hat, H accented hat, . nothing. */
export const BED_KIT = "kh.hsh.hkh.hshhh";
export const KICK = { fromHz: 150, toHz: 42, glideSec: 0.11, peak: 0.55, decaySec: 0.16, stopSec: 0.2 } as const;
export const SNARE = { hz: 1_800, peak: 0.32, decaySec: 0.12 } as const;
export const HAT = { hz: 7_500, peak: 0.08, accent: 0.14, decaySec: 0.04 } as const;
export const SILENT = 0.001;
export const NOISE_TAIL_SEC = 0.02;
/** MIDI note 69 is A4 at 440 Hz; twelve semitones an octave. */
export const A4_MIDI = 69;
export const A4_HZ = 440;
export const SEMITONES = 12;

// ── Vibration (Mitoshi feedback.ts): kept short; a buzz that talks over a hand is a setting people turn off ──

export const VIBRATE_MS = {
  tap: 8,
  confirm: 18,
  deny: 36,
  crash: 60,
  "swipe-up": 18,
  "swipe-down": 18,
  "card-win": 24,
  "card-loss": 36,
  "match-found": 40,
  "duel-win": 60,
  "duel-lose": 60,
  click: 8,
  "modal-open": 0,
  "modal-close": 0,
} as const;

// ── Motion (Mitoshi motion.ts: Pips's easings and springs, Flicky's two card timings) ──

export const EASE_OUT_CUBIC: readonly [number, number, number, number] = [0.33, 1, 0.68, 1];
/** Flicky: a thrown card leaves opaque and spinning, in 300 ms. */
export const THROW_SEC = 0.3;
/** A card that wasn't thrown springs back. */
export const SETTLE_SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;
/** Flicky: the card tilts up to 18° across half its height, and 6° more as it flies off. */
export const DRAG_MAX_ROTATE_DEG = 18;
export const FLY_ROTATE_DEG = 24;
/** Flicky: the UP/DOWN stamp appears past this much travel. */
export const STAMP_AT_PX = 24;
/** Past this travel, or this fast, the throw counts; below both the card springs back. */
export const COMMIT_TRAVEL_PX = 84;
export const COMMIT_VELOCITY = 480;
/** Far enough to clear the tallest card; the stack is clipped by the page. */
export const THROW_DISTANCE_PX = 420;
/** The card's height before the deck has measured itself (only the tilt's scale depends on it). */
export const FALLBACK_CARD_PX = 420;
export const DRAG_ELASTIC = 0.7;
/** The card under the top one rises 10 px and grows from 96.5 % as the top one is dragged away. */
export const BEHIND_RISE_PX = 10;
export const BEHIND_SCALE = 0.965;
export const ENTER = { opacity: 0, scale: 0.96, y: 12 } as const;
export const REDUCED_EXIT_SEC = 0.01;
/** How long a refused side's reason stays under the calls. */
export const LOCKED_HINT_MS = 4_000;

// ── The hall ──

/** Mode numbers read 01–07; the now-playing strip's minimum loop and its slow-down under the pointer. */
export const INDEX_DIGITS = 2;
export const MARQUEE_MIN_SEC = 24;
export const MARQUEE_SEC_PER_ITEM = 4;
export const MARQUEE_HOVER_SEC = 120;
export const MARQUEE_GAP_REM = 1.5;
/** Practice's cabinet asks for a Window with at least the deal's life left (the deck's rule). */
export const CABINET_REFRESH_MS = 30_000;

/** A profile's badge stickers lean a little each way, like the hall's. */
export const BADGE_TILTS = [-3, 2, -2, 3] as const;
