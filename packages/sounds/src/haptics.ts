import { type HapticWord, VIBRATION } from "./constants";

/**
 * Haptic words on the web: `navigator.vibrate` where a device has it (Android). iOS Safari has no vibration API,
 * so there the words are silent (the Kakure app plays them with expo-haptics). Browsers refuse vibration before
 * the first tap (and log it), so a cue that arrives on its own before then, like a batch landing, stays silent.
 */
export function vibrate(word: HapticWord): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      navigator.vibrate(VIBRATION[word]);
    }
  } catch {
    // No haptics here.
  }
}

export function hapticsAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}
