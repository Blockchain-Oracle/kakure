"use client";

import { useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/storage";
import { gameKey } from "../keys";

/**
 * Practice's tally on this device (rounds played and won against the coin, and 5–0 sweeps), for the hall's
 * achievements. Nothing about a round leaves the device.
 */
export interface PracticeTally {
  played: number;
  won: number;
  sweeps: number;
}

const KEY = gameKey("practice");
const NONE: PracticeTally = { played: 0, won: 0, sweeps: 0 };
const listeners = new Set<() => void>();
let tally: PracticeTally | null = null;

function read(): PracticeTally {
  if (tally) return tally;
  try {
    tally = { ...NONE, ...(JSON.parse(safeStorage.getItem(KEY) ?? "{}") as Partial<PracticeTally>) };
  } catch {
    tally = NONE;
  }
  return tally;
}

export function recordPracticeRound(won: boolean, sweep: boolean): void {
  const now = read();
  tally = { played: now.played + 1, won: now.won + (won ? 1 : 0), sweeps: now.sweeps + (sweep ? 1 : 0) };
  safeStorage.setItem(KEY, JSON.stringify(tally));
  for (const listener of listeners) listener();
}

export function usePracticeTally(): PracticeTally {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => NONE,
  );
}
