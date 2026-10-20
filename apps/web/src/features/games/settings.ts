"use client";

import { useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/storage";
import { gameKey } from "./keys";

/**
 * The accent a player wears in the games (Mitoshi `features/games/settings.ts`): a colour the design system already
 * has, the brand's vermilion or one of the market's two sides. Sound, haptics and motion are Kakure's own device
 * settings (features/settings/prefs-store.ts), so the games and the terminal never disagree about them.
 */
export type AccentChoice = "vermilion" | "up" | "down";

export const ACCENT_CHOICES: readonly AccentChoice[] = ["vermilion", "up", "down"];
export const ACCENT_LABELS: Readonly<Record<AccentChoice, string>> = { vermilion: "Vermilion", up: "Up", down: "Down" };

const KEY = gameKey("accent");
const listeners = new Set<() => void>();
let accent: AccentChoice | null = null;

function read(): AccentChoice {
  if (accent) return accent;
  const raw = safeStorage.getItem(KEY);
  accent = ACCENT_CHOICES.includes(raw as AccentChoice) ? (raw as AccentChoice) : "vermilion";
  return accent;
}

export function setAccent(next: AccentChoice): void {
  accent = next;
  safeStorage.setItem(KEY, next);
  for (const listener of listeners) listener();
}

export function useAccent(): AccentChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => "vermilion",
  );
}
