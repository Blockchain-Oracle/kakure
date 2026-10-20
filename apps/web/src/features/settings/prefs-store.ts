"use client";

import { setFeedbackPreferences } from "@kakure/sounds";
import { useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "@/constants";
import { safeStorage } from "@/lib/storage";

/**
 * Device preferences (surfaces.md Settings): sound, volume, haptics, the portfolio sound ladder, motion and the
 * privacy eye. Stored on this device only. Motion is three-way (Mitoshi's games setting): "system" follows the OS,
 * "reduce" sets <html data-motion="reduce"> and "full" sets <html data-motion="full">, an explicit choice that beats the
 * OS in either direction (the CSS motion variants read both).
 */
export type MotionChoice = "system" | "full" | "reduce";

export interface Prefs {
  sound: boolean;
  /** 0..1 */
  volume: number;
  haptics: boolean;
  ladder: boolean;
  motion: MotionChoice;
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
  if (prefs.motion === "system") delete root.dataset.motion;
  else root.dataset.motion = prefs.motion;
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

/** The player's explicit choice wins; "system" defers to the OS. */
export function reducedMotionFrom(choice: MotionChoice, systemPrefersReduced: boolean): boolean {
  if (choice === "reduce") return true;
  if (choice === "full") return false;
  return systemPrefersReduced;
}

/** Reduced motion from the in-app setting, or the system's when it follows the system. */
export function prefersReducedMotion(): boolean {
  return reducedMotionFrom(read().motion, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
