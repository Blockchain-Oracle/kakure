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
const played = new Set<string>();
const IDENTITY_KEY = "kakure.cues.v1";
const IDENTITY_LIMIT = 500;

function loadIdentities() {
  try {
    const stored = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? "[]") as string[];
    for (const identity of stored) played.add(identity);
  } catch {
    // Nothing remembered yet.
  }
}

function rememberIdentity(identity: string) {
  played.add(identity);
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify([...played].slice(-IDENTITY_LIMIT)));
  } catch {
    // Storage blocked: dedupe lasts this visit.
  }
}

let identitiesLoaded = false;

export function setFeedbackPreferences(next: FeedbackPreferences): void {
  preferences = next;
  setVolume(next.sound ? next.volume : 0);
}

/**
 * The one call site for sound and haptics (Kawase's `fire`). An outcome cue carries an `identity` (a ticket hash
 * plus its state) and plays once per identity, remembered on this device so a reload never replays a win.
 * Haptics follow their own switch; sounds follow the sound switch and volume.
 */
export function fire(cue: CueName, options: { identity?: string; step?: number; haptic?: HapticWord | false } = {}) {
  if (options.identity) {
    if (!identitiesLoaded) {
      loadIdentities();
      identitiesLoaded = true;
    }
    if (played.has(options.identity)) return;
    rememberIdentity(options.identity);
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
