"use client";

import type { ArcadeGame } from "@kakure/arcade";
import { useSyncExternalStore } from "react";
import { STORAGE_PREFIX } from "@/constants";
import { safeStorage } from "@/lib/storage";
import { RUNS_KEPT } from "./constants";

/**
 * What this device remembers about its arcade play (plan §0 R4), in this browser only: the nickname its key holds, and
 * the runs the service accepted (game, score, where it ranked, the day). History reads them; nothing here is sent
 * anywhere, and Forget this device clears it.
 */
const NICKNAME_KEY = `${STORAGE_PREFIX}arcade.nickname`;
const RUNS_KEY = `${STORAGE_PREFIX}arcade.runs`;

export interface KeptRun {
  game: ArcadeGame;
  score: number;
  rank: number;
  best: boolean;
  calm: boolean;
  /** `YYYYMMDD`, as the board keeps it. */
  day: number;
}

const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let nickname: string | null | undefined;
let runs: KeptRun[] | undefined;

function readNickname(): string | null {
  if (nickname === undefined) nickname = safeStorage.getItem(NICKNAME_KEY);
  return nickname;
}

function readRuns(): KeptRun[] {
  if (runs === undefined) {
    try {
      const parsed = JSON.parse(safeStorage.getItem(RUNS_KEY) ?? "[]") as unknown;
      runs = Array.isArray(parsed) ? (parsed as KeptRun[]) : [];
    } catch {
      runs = [];
    }
  }
  return runs;
}

export function setNickname(next: string): void {
  nickname = next;
  safeStorage.setItem(NICKNAME_KEY, next);
  emit();
}

export function keepRun(run: KeptRun): void {
  runs = [run, ...readRuns()].slice(0, RUNS_KEPT);
  safeStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  emit();
}

export function clearRuns(): void {
  runs = [];
  safeStorage.removeItem(RUNS_KEY);
  emit();
}

const NO_RUNS: KeptRun[] = [];

export function useNickname(): string | null {
  return useSyncExternalStore(subscribe, readNickname, () => null);
}

export function useKeptRuns(): KeptRun[] {
  return useSyncExternalStore(subscribe, readRuns, () => NO_RUNS);
}

/** Today as the arcade keeps days: `YYYYMMDD`, in UTC. */
export function today(): number {
  return Number(new Date().toISOString().slice(0, "YYYY-MM-DD".length).replaceAll("-", ""));
}

/** `YYYYMMDD` as a short date ("Oct 20"). */
export function dayLabel(day: number): string {
  const text = String(day);
  const iso = `${text.slice(0, "YYYY".length)}-${text.slice("YYYY".length, "YYYYMM".length)}-${text.slice("YYYYMM".length)}`;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
