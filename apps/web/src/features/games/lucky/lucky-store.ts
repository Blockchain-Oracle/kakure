"use client";

import type { LuckyDraw, LuckyResult } from "@kakure/arcade";
import type { Network } from "@kakure/domain";
import { useSyncExternalStore } from "react";
import type { PositionRecord } from "@/features/wallet/records";
import { safeStorage } from "@/lib/storage";
import { gameKey } from "../keys";
import { DRAWS_KEPT } from "./constants";

/**
 * Lucky's draws on this device (plan §0 R5: "draws stay on the device"): what each spin was keyed by and drew, and,
 * once placed, the position it became. Its result is read from the vault's own position, never stored twice. Forget
 * this device clears the list.
 */
export interface KeptDraw {
  at: number;
  network: Network;
  bundleSeq: number;
  bundleHash: string;
  seed: string;
  candidateHash: string;
  candidates: number;
  draw: LuckyDraw;
  windowId: string | null;
  dealtAskE4: number | null;
  stakeZat: number;
  /** The position's key once placed. */
  positionKey: string | null;
}

const KEY = gameKey("lucky");
const listeners = new Set<() => void>();
let draws: KeptDraw[] | null = null;

function read(): KeptDraw[] {
  if (draws) return draws;
  try {
    const parsed = JSON.parse(safeStorage.getItem(KEY) ?? "[]") as unknown;
    draws = Array.isArray(parsed) ? (parsed as KeptDraw[]) : [];
  } catch {
    draws = [];
  }
  return draws;
}

function write(next: KeptDraw[]) {
  draws = next.slice(0, DRAWS_KEPT);
  safeStorage.setItem(KEY, JSON.stringify(draws));
  for (const listener of listeners) listener();
}

export function keepDraw(draw: KeptDraw): void {
  write([draw, ...read()]);
}

/** Marks the newest draw with this seed as placed, with its position. */
export function markPlaced(seed: string, positionKey: string): void {
  write(read().map((d) => (d.seed === seed ? { ...d, positionKey } : d)));
}

const NONE: KeptDraw[] = [];

export function useKeptDraws(): KeptDraw[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => NONE,
  );
}

/** A placed draw's result, from its position in the vault: riding until it's paid, then what the close decided. */
export function resultOf(position: PositionRecord | undefined): LuckyResult | null {
  if (!position?.certificate) return null;
  if (position.state !== "paid") return "riding";
  const paid = Number(position.paidZat ?? 0);
  const stake = Number(position.certificate.stakeZat);
  if (position.how !== "redeem" && position.how !== "settled") return "closed";
  if (paid === stake) return "refund";
  return paid > stake ? "won" : "lost";
}
