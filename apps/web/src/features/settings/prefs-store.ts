"use client";

import { setFeedbackPreferences } from "@kakure/sounds";
import { useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "@/constants";
import { safeStorage } from "@/lib/storage";

/**
 * Device preferences (surfaces.md Settings): sound, volume, haptics, the portfolio sound ladder, motion and the
 * privacy eye. Stored on this device only. Motion "reduce" sets <html data-motion="reduce">, which the CSS treats
 * like the system's reduced-motion setting.
 */
export interface Prefs {
  sound: boolean;
  /** 0..1 */
  volume: number;
  haptics: boolean;
  ladder: boolean;
  motion: "system" | "reduce";
  hideAmounts: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  sound: true,
  volume: 0.8,
  haptics: true,
  ladder: true,
  motion: "system",
  hideAmounts: false,
};

const listeners = new Set<() => void>();
let current: Prefs | null = null;

function read(): Prefs {
  if (current) return current;
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    current = { ...DEFAULT_PREFS, ...(JSON.parse(safeStorage.getItem(STORAGE_KEYS.prefs) ?? "{}") as Partial<Prefs>) };
  } catch {
    current = DEFAULT_PREFS;
  }
  apply(current);
  return current;
}

function apply(prefs: Prefs) {
  setFeedbackPreferences({ sound: prefs.sound, volume: prefs.volume, haptics: prefs.haptics });
  const root = document.documentElement;
  if (prefs.motion === "reduce") root.dataset.motion = "reduce";
  else delete root.dataset.motion;
}

export function getPrefs(): Prefs {
  return read();
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...read(), ...patch };
  safeStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(current));
  apply(current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_PREFS);
}

/** Reduced motion from the system or the in-app setting. */
export function prefersReducedMotion(): boolean {
  return read().motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
