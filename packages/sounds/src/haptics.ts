import { type HapticWord, VIBRATION } from "./constants";

/**
 * Haptic words on the web: `navigator.vibrate` where a device has it (Android). iOS Safari has no vibration API,
 * so there the words are silent (the Kakure app plays them with expo-haptics). Failures are silent.
 */
export function vibrate(word: HapticWord): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(VIBRATION[word]);
    }
  } catch {
    // No haptics here.
  }
}

export function hapticsAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}
