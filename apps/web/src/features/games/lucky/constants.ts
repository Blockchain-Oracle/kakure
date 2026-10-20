/** Lucky's figures (Mitoshi `lucky/*`, `components/ui/slot-reel.tsx`), by value. */

/** The reels stop 720 / 980 / 1,240 ms in, and the pick is held lit a beat before the deal (Pips's lock-in). */
export const STOPS_MS = [720, 980, 1_240] as const;
export const LOCKIN_MS = 480;
/** A reel shows three rows, tumbles three shuffled cycles, and settles with a small overshoot. */
export const REEL = { rows: 3, cycles: 3, spinSec: 1.2, settleSec: 0.3, tickGapMs: 60 } as const;
export const OVERSHOOT: readonly [number, number, number, number] = [0.34, 1.56, 0.64, 1];

/** Four stakes from the chip ladder, in zatoshi: 0.001, 0.005, 0.01 and 0.05. */
export const LUCKY_STAKES_ZAT = [100_000, 500_000, 1_000_000, 5_000_000] as const;
/** The draws this device keeps for its floor and streaks. */
export const DRAWS_KEPT = 50;
export const MS_PER_SEC = 1_000;
/** The proof shows hashes cut to this many characters each side. */
export const HASH_EDGE = 10;

/** The reels' voices (Owarine's reel-sfx, in this app's numbers). */
export const REEL_SFX = {
  floor: 0.0001,
  noiseSec: 0.25,
  shimmerRatio: 2.012,
  cutoffRatio: 5,
  cutoffMaxHz: 8_000,
  attackSec: 0.008,
  shimmerAttackSec: 0.006,
  shimmerGain: 0.2,
  shimmerLength: 0.6,
  tailSec: 0.05,
  spin: { q: 0.8, fromHz: 300, toHz: 2_400, glideSec: 0.24, peak: 0.03, riseSec: 0.05, decaySec: 0.28, stopSec: 0.32 },
  spinChord: [
    { hz: 523.25, at: 0, sec: 0.14, gain: 0.035 },
    { hz: 659.25, at: 0.05, sec: 0.14, gain: 0.035 },
    { hz: 783.99, at: 0.1, sec: 0.18, gain: 0.04 },
  ],
  tick: { q: 1.6, baseHz: 1_600, spreadHz: 1_000, peak: 0.012, riseSec: 0.002, decaySec: 0.03, stopSec: 0.04 },
  thunk: { fromHz: 190, toHz: 90, glideSec: 0.1, peak: 0.05, riseSec: 0.006, decaySec: 0.13, stopSec: 0.15 },
  click: { hz: 3_400, peak: 0.02, riseSec: 0.002, decaySec: 0.04, stopSec: 0.05 },
  lockNotes: [880, 1_108.73, 1_318.51],
  lock: {
    at: 0.005,
    sec: 0.16,
    lastSec: 0.32,
    gain: 0.05,
    sparkleHz: 1_760,
    sparkleAt: 0.08,
    sparkleSec: 0.24,
    sparkleGain: 0.025,
  },
  pick: [
    { hz: 987.77, at: 0, sec: 0.16, gain: 0.045 },
    { hz: 1_318.51, at: 0.06, sec: 0.18, gain: 0.05 },
    { hz: 1_760, at: 0.12, sec: 0.26, gain: 0.055 },
  ],
} as const;
