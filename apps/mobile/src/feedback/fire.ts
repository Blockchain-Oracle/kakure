import { CUES, type CueName, type HapticWord, LADDER_SEMITONES } from "@kakure/sounds";
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Haptics from "expo-haptics";
import { AppState, Platform } from "react-native";
import { readText, writeText } from "@/lib/kv";
import { prefsStore } from "@/settings/prefs";
import { CUE_SOURCES, type CueSourceKey } from "./generated/cue-sources";

/**
 * The one call site for sound and haptics (kawase.md §9.1). Cues are @kakure/sounds' definitions rendered to WAV
 * (scripts/render-sounds.mjs). "No sound for ticks or navigation": a sound is for money and outcomes.
 * Nothing here ever throws into a money flow: every failure is swallowed.
 */

/** Hot cues get two players so a quick repeat overlaps instead of waiting for a rewind (Kawase's pool). */
const POOL_SIZE = 2;
const HOT: ReadonlySet<CueSourceKey> = new Set(["toggle", "adverse", "batch"]);
const IDENTITY_KEY = "kakure.cues.v1";
const IDENTITY_LIMIT = 500;

const players = new Map<CueSourceKey, AudioPlayer[]>();
const next = new Map<CueSourceKey, number>();
let played: Set<string> | null = null;
let foreground = AppState.currentState === "active";

function sourceKey(cue: CueName, step: number): CueSourceKey {
  if (cue !== "profit") return cue as CueSourceKey;
  const clamped = Math.min(Math.max(0, step), LADDER_SEMITONES.length - 1);
  return `profit-${clamped}` as CueSourceKey;
}

function playersFor(key: CueSourceKey): AudioPlayer[] {
  const existing = players.get(key);
  if (existing) return existing;
  const count = HOT.has(key) || key.startsWith("profit") ? POOL_SIZE : 1;
  const created = Array.from({ length: count }, () => createAudioPlayer(CUE_SOURCES[key]));
  players.set(key, created);
  return created;
}

/** Creates every player at launch so the first cue plays on time (Kawase's warm-up). */
export function warmSounds(): void {
  try {
    void setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: "mixWithOthers",
      shouldPlayInBackground: false,
    });
    for (const key of Object.keys(CUE_SOURCES) as CueSourceKey[]) playersFor(key);
  } catch {
    // Sounds are a courtesy.
  }
  AppState.addEventListener("change", (state) => {
    foreground = state === "active";
  });
}

function playSound(cue: CueName, step: number): void {
  if (!foreground) return;
  try {
    const key = sourceKey(cue, step);
    const pool = playersFor(key);
    const index = next.get(key) ?? 0;
    next.set(key, (index + 1) % pool.length);
    const player = pool[index];
    if (!player) return;
    player.seekTo(0);
    player.play();
  } catch {
    // A failed cue is never an error for the person.
  }
}

/** Android's own haptic constants per word (kawase.md §9.5): no VIBRATE permission, the system's feel. */
const ANDROID: Record<HapticWord, Haptics.AndroidHaptics> = {
  tick: Haptics.AndroidHaptics.Segment_Tick,
  move: Haptics.AndroidHaptics.Clock_Tick,
  press: Haptics.AndroidHaptics.Virtual_Key,
  snap: Haptics.AndroidHaptics.Gesture_End,
  confirm: Haptics.AndroidHaptics.Confirm,
  filled: Haptics.AndroidHaptics.Confirm,
  warn: Haptics.AndroidHaptics.Reject,
  fail: Haptics.AndroidHaptics.Reject,
  surge: Haptics.AndroidHaptics.Long_Press,
};

/** Haptic words (kawase.md §9.5): iOS semantic feedback, Android haptic constants. Failures are silent. */
export function haptic(word: HapticWord): void {
  if (!prefsStore.get().haptics) return;
  if (Platform.OS === "android") {
    Haptics.performAndroidHapticsAsync(ANDROID[word]).catch(() => undefined);
    return;
  }
  const run = (): Promise<void> => {
    switch (word) {
      case "tick":
      case "move":
        return Haptics.selectionAsync();
      case "press":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case "snap":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      case "confirm":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      case "filled":
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case "warn":
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case "fail":
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      case "surge":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  };
  run().catch(() => undefined);
}

function seen(identity: string): boolean {
  if (!played) {
    try {
      played = new Set(JSON.parse(readText(IDENTITY_KEY) ?? "[]") as string[]);
    } catch {
      played = new Set();
    }
  }
  if (played.has(identity)) return true;
  played.add(identity);
  writeText(IDENTITY_KEY, JSON.stringify([...played].slice(-IDENTITY_LIMIT)));
  return false;
}

/**
 * Plays a cue and its haptic. An outcome cue carries an `identity` (a ticket hash plus its state) and plays once per
 * identity, remembered on this device, so a remount or relaunch never replays a win.
 */
export function fire(cue: CueName, options: { identity?: string; step?: number; haptic?: HapticWord | false } = {}) {
  if (options.identity && seen(options.identity)) return;
  if (prefsStore.get().sound) playSound(cue, options.step ?? 0);
  const word = options.haptic === false ? undefined : (options.haptic ?? CUES[cue].haptic);
  if (word) haptic(word);
}
