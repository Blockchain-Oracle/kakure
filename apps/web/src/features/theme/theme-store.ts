"use client";

import { useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "@/constants";
import { safeStorage } from "@/lib/storage";

/**
 * Dark is the default; cream light is the alternative (Mitoshi lib/theme.ts:30-33: the stored choice wins, else the
 * OS asking for light, else dark). "system" follows the OS that way. The init script applies it before first paint.
 */
export type ThemeMode = "light" | "dark" | "system";

const listeners = new Set<() => void>();
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function readMode(): ThemeMode {
  if (typeof document === "undefined") return "system";
  const mode = document.documentElement.dataset.themeMode;
  return mode === "light" || mode === "dark" ? mode : "system";
}

function readDark(): boolean {
  return typeof document === "undefined" ? true : document.documentElement.classList.contains("dark");
}

/** The phone browser's bar takes the page's ground (Mitoshi `syncThemeColor`): the theme and the world's tint. */
export function syncThemeColor() {
  if (!document.body) return;
  const color = getComputedStyle(document.body).backgroundColor;
  if (!color || color === "transparent") return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", color);
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && !window.matchMedia(LIGHT_QUERY).matches);
  root.classList.toggle("dark", dark);
  root.dataset.themeMode = mode;
  syncThemeColor();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(LIGHT_QUERY);
  const onSystem = () => {
    if (readMode() === "system") {
      applyMode("system");
      for (const each of listeners) each();
    }
  };
  media.addEventListener("change", onSystem);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystem);
  };
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, readMode, () => "system");
}

/** Whether the page is dark right now (the rail's two-state toggle). */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, readDark, () => true);
}

/** Theme changes cross-fade through a view transition; instantly under reduced motion. */
export function setThemeMode(mode: ThemeMode) {
  safeStorage.setItem(STORAGE_KEYS.theme, mode);
  const update = () => {
    applyMode(mode);
    for (const listener of listeners) listener();
  };
  const reduced =
    document.documentElement.dataset.motion === "reduce" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  document.startViewTransition(update);
}
