import { STORAGE_KEYS } from "@/constants";
import { readJson, writeJson } from "@/lib/kv";
import { createStore, useStore } from "@/lib/store";

/** Settings (surfaces.md Mobile → Settings). Sounds start on, like Kawase (X18); motion follows the system. */
export interface Prefs {
  sound: boolean;
  haptics: boolean;
  /** "system" follows Reduce Motion; "reduce" forces crossfades everywhere. */
  motion: "system" | "reduce";
  /** The privacy eye: amounts are not rendered at all while hidden (C9). */
  hideAmounts: boolean;
  /** Ask for Face ID / the device passcode when the app opens. */
  biometricLock: boolean;
  /** Colour scheme: follow the system or force one. */
  appearance: "system" | "light" | "dark";
}

const DEFAULTS: Prefs = {
  sound: true,
  haptics: true,
  motion: "system",
  hideAmounts: false,
  biometricLock: false,
  appearance: "system",
};

export const prefsStore = createStore<Prefs>(readJson(STORAGE_KEYS.prefs, DEFAULTS), (value) =>
  writeJson(STORAGE_KEYS.prefs, value),
);

export function setPrefs(patch: Partial<Prefs>): void {
  prefsStore.set((previous) => ({ ...previous, ...patch }));
}

export const usePrefs = () => useStore(prefsStore);
