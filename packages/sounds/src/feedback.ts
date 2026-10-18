import { CUES, type CueName, type HapticWord } from "./constants";
import { playCue, setVolume, unlockAudio } from "./engine";
import { vibrate } from "./haptics";

export interface FeedbackPreferences {
  sound: boolean;
  /** 0..1 */
  volume: number;
  haptics: boolean;
}

let preferences: FeedbackPreferences = { sound: true, volume: 1, haptics: true };
/**
 * Identities already played, in memory for this visit only. Nothing is written to localStorage: an identity names a
 * ticket and its outcome, which must never sit on the device in the clear (O4). A cue that must survive a reload
 * keeps its "already played" mark inside the app's encrypted ticket record instead.
 */
const played = new Set<string>();

/** The pre-O4 cue memory key; removed on start so old plaintext ticket hashes don't linger. */
const LEGACY_IDENTITY_KEY = "kakure.cues.v1";

export function clearLegacyCueMemory(): void {
  try {
    localStorage.removeItem(LEGACY_IDENTITY_KEY);
  } catch {
    // No storage here.
  }
}

export function setFeedbackPreferences(next: FeedbackPreferences): void {
  preferences = next;
  setVolume(next.sound ? next.volume : 0);
}

/**
 * The one call site for sound and haptics (Kawase's `fire`). A cue with an `identity` plays once per identity for
 * this visit. Haptics follow their own switch; sounds follow the sound switch and volume.
 */
export function fire(cue: CueName, options: { identity?: string; step?: number; haptic?: HapticWord | false } = {}) {
  if (options.identity) {
    if (played.has(options.identity)) return;
    played.add(options.identity);
  }
  if (preferences.sound && preferences.volume > 0) playCue(cue, options.step);
  const haptic = options.haptic === false ? undefined : (options.haptic ?? CUES[cue].haptic);
  if (preferences.haptics && haptic) vibrate(haptic);
}

/** Wire once at the app root: the first gesture unlocks audio (browsers refuse sound before one). */
export function installAudioUnlock(): () => void {
  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
  return () => {
    window.removeEventListener("pointerdown", unlock, { capture: true });
    window.removeEventListener("keydown", unlock, { capture: true });
  };
}
