"use client";

import { useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "@/constants";
import { safeStorage } from "@/lib/storage";

/** Light is the default; dark is an adaptation (kawase.md §4.2). "system" follows the OS. */
export type ThemeMode = "light" | "dark" | "system";

const listeners = new Set<() => void>();
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readMode(): ThemeMode {
  if (typeof document === "undefined") return "system";
  const mode = document.documentElement.dataset.themeMode;
  return mode === "light" || mode === "dark" ? mode : "system";
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && window.matchMedia(DARK_QUERY).matches);
  root.classList.toggle("dark", dark);
  root.dataset.themeMode = mode;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  const onSystem = () => {
    if (readMode() === "system") applyMode("system");
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

/** Theme changes cross-fade through a view transition (Owarine's ThemeToggle); instantly under reduced motion. */
export function setThemeMode(mode: ThemeMode) {
  safeStorage.setItem(STORAGE_KEYS.theme, mode);
  const update = () => {
    applyMode(mode);
    for (const listener of listeners) listener();
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  document.startViewTransition(update);
}
