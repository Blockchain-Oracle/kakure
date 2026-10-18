import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * True while the app isn't the active foreground app: in the app switcher, in the background, or behind a system
 * sheet (Face ID, Control Center, a call). iOS photographs the screen for the app switcher as the app leaves, and
 * `inactive` arrives first, so a screen that swaps its secret for a cover on this flag is covered in that picture
 * (audit O17). Android's recents preview is blanked by FLAG_SECURE (usePreventScreenCapture) on the same screens.
 */
export function useAway(enabled = true): boolean {
  const [away, setAway] = useState(() => AppState.currentState !== "active" && AppState.currentState !== "unknown");
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener("change", (state) => setAway(state !== "active"));
    return () => subscription.remove();
  }, [enabled]);
  return enabled && away;
}
