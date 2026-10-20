"use client";

import { DEFAULT_SLIPPAGE_BPS, ladderFloor, SLIPPAGE_CHOICES_BPS } from "@kakure/domain";
import { CANDLE_INTERVALS, type CandleInterval } from "@kakure/feeds/protocol";
import { useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "@/constants";
import { safeStorage } from "@/lib/storage";
import { DEFAULT_SIZE_SHARE, MUSIC_TRACKS, TRAIL_MAX, TRAIL_MIN } from "./constants";

/**
 * The terminal's settings (Owarine `terminal/settings.ts`, Tradash's `settings` slice): one object on this device
 * behind try/catch (a private window simply uses the defaults). Size is the stake in zatoshi; while untouched it
 * follows 5 % of the chips available. Sound and haptics are the app's own preferences (Settings), not kept twice.
 */
export type MusicTrack = (typeof MUSIC_TRACKS)[number];

export interface TradeSettings {
  /** The stake once set; null while it follows 5 % of available. */
  sizeZat: number | null;
  /** Trail distance as a fraction (0.001 = 0.10 %). */
  trailPct: number;
  /** The price tolerance on a trade or a close, in basis points. */
  slippageBps: number;
  /** Emoji callouts and the edge flash (sounds and haptics play regardless). */
  reactionsEnabled: boolean;
  musicEnabled: boolean;
  musicTrack: MusicTrack;
  tutorialSeen: boolean;
  favourites: string[];
  chartView: "line" | "candles";
  chartInterval: CandleInterval;
}

const DEFAULTS: TradeSettings = {
  sizeZat: null,
  trailPct: TRAIL_MIN,
  slippageBps: DEFAULT_SLIPPAGE_BPS,
  reactionsEnabled: true,
  musicEnabled: false,
  musicTrack: "arcade",
  tutorialSeen: false,
  favourites: [],
  chartView: "line",
  chartInterval: "1m",
};

const MAX_SLIPPAGE_BPS = 2_000;
const MAX_FAVOURITES = 100;
const listeners = new Set<() => void>();
let current: TradeSettings = DEFAULTS;
let hydrated = false;

const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function read(): TradeSettings {
  try {
    const raw = safeStorage.getItem(STORAGE_KEYS.trade);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<TradeSettings>;
    return {
      sizeZat: num(p.sizeZat, 1, Number.MAX_SAFE_INTEGER) ? p.sizeZat : null,
      trailPct: num(p.trailPct, TRAIL_MIN, TRAIL_MAX) ? p.trailPct : DEFAULTS.trailPct,
      slippageBps: num(p.slippageBps, 0, MAX_SLIPPAGE_BPS) ? p.slippageBps : DEFAULTS.slippageBps,
      reactionsEnabled: typeof p.reactionsEnabled === "boolean" ? p.reactionsEnabled : true,
      musicEnabled: typeof p.musicEnabled === "boolean" ? p.musicEnabled : false,
      musicTrack: MUSIC_TRACKS.includes(p.musicTrack as MusicTrack) ? (p.musicTrack as MusicTrack) : "arcade",
      tutorialSeen: p.tutorialSeen === true,
      favourites: Array.isArray(p.favourites)
        ? p.favourites.filter((s): s is string => typeof s === "string").slice(0, MAX_FAVOURITES)
        : [],
      chartView: p.chartView === "candles" ? "candles" : "line",
      chartInterval: CANDLE_INTERVALS.includes(p.chartInterval as CandleInterval)
        ? (p.chartInterval as CandleInterval)
        : "1m",
    };
  } catch {
    return DEFAULTS;
  }
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  current = read();
}

export function setTradeSettings(next: Partial<TradeSettings>): void {
  hydrate();
  current = { ...current, ...next };
  safeStorage.setItem(STORAGE_KEYS.trade, JSON.stringify(current));
  for (const listener of listeners) listener();
}

export function tradeSettings(): TradeSettings {
  hydrate();
  return current;
}

/** Null before this device's settings are read (the server render and the first client pass), then the settings. */
export function useTradeSettingsState(): TradeSettings | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      hydrate();
      return current;
    },
    () => null,
  );
}

export function useTradeSettings(): TradeSettings {
  return useTradeSettingsState() ?? DEFAULTS;
}

/**
 * The stake a tap uses: the set size, or 5 % of available, never under `min`, snapped down to the chip ladder (1, 2 or
 * 5 × 10^k), so the stake never encodes the balance and is paid in exact chips (privacy re-audit V3).
 */
export function stakeFor(settings: Pick<TradeSettings, "sizeZat">, availableZat: number, minZat: number): number {
  const auto = Math.max(minZat, DEFAULT_SIZE_SHARE * availableZat);
  const want = settings.sizeZat ?? auto;
  return Math.max(minZat, ladderFloor(Math.max(minZat, want)));
}

export { SLIPPAGE_CHOICES_BPS };
