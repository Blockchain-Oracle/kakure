"use client";

import type { DuelPick } from "@kakure/arcade";
import { safeStorage } from "@/lib/storage";
import { gameKey } from "../keys";

/**
 * A match's picks and their salt, held on this device between the commitment and the reveal (so a reload in between
 * can still reveal). Dropped once the match is past revealing. Never sent until both players are locked in.
 */
const KEY = gameKey("duelPicks");
const SALT_BYTES = 16;
const HEX_RADIX = 16;
const HEX_PAD = 2;

export interface HeldPicks {
  matchId: string;
  picks: DuelPick[];
  salt: string;
  committed: boolean;
}

export function freshSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(SALT_BYTES)), (b) =>
    b.toString(HEX_RADIX).padStart(HEX_PAD, "0"),
  ).join("");
}

export function heldPicks(matchId: string): HeldPicks | null {
  try {
    const held = JSON.parse(safeStorage.getItem(KEY) ?? "null") as HeldPicks | null;
    return held?.matchId === matchId ? held : null;
  } catch {
    return null;
  }
}

export function holdPicks(held: HeldPicks): void {
  safeStorage.setItem(KEY, JSON.stringify(held));
}

export function dropPicks(): void {
  safeStorage.removeItem(KEY);
}
