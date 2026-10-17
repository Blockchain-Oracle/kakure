import type { StreamSymbol } from "@kakure/feeds/protocol";
import { useEffect, useSyncExternalStore } from "react";
import { prices } from "./data-provider";

/**
 * Prices seen by this app since it opened, per symbol, kept in memory only (a chart needs a line; there is no
 * archived history yet, plan §13.15, so the chart says "since you opened" and never invents a past).
 */
export interface Sample {
  at: number;
  price: number;
}

const MAX_SAMPLES = 600;
const rings = new Map<StreamSymbol, Sample[]>();
const versions = new Map<StreamSymbol, number>();
const watchers = new Map<StreamSymbol, () => void>();
const listeners = new Map<StreamSymbol, Set<() => void>>();

function record(symbol: StreamSymbol) {
  const state = prices.get(symbol);
  if (state.status !== "live" && state.status !== "stale") return;
  const price = Number(state.price);
  if (!Number.isFinite(price)) return;
  const ring = rings.get(symbol) ?? [];
  const last = ring[ring.length - 1];
  if (last && last.at === state.ts) return;
  ring.push({ at: state.ts ?? Date.now(), price });
  if (ring.length > MAX_SAMPLES) ring.splice(0, ring.length - MAX_SAMPLES);
  rings.set(symbol, ring);
  versions.set(symbol, (versions.get(symbol) ?? 0) + 1);
  for (const listener of listeners.get(symbol) ?? []) listener();
}

/** Starts recording a symbol (idempotent); recording continues for the app session. */
function watch(symbol: StreamSymbol) {
  if (watchers.has(symbol)) return;
  watchers.set(
    symbol,
    prices.subscribe(symbol, () => record(symbol)),
  );
  record(symbol);
}

const EMPTY: Sample[] = [];

export function useSamples(symbol: StreamSymbol | null): Sample[] {
  useEffect(() => {
    if (symbol) watch(symbol);
  }, [symbol]);
  useSyncExternalStore(
    (listener) => {
      if (!symbol) return () => undefined;
      const set = listeners.get(symbol) ?? new Set();
      set.add(listener);
      listeners.set(symbol, set);
      return () => set.delete(listener);
    },
    () => (symbol ? (versions.get(symbol) ?? 0) : 0),
  );
  return symbol ? (rings.get(symbol) ?? EMPTY) : EMPTY;
}

/** When this app first saw the symbol (the left edge of "since you opened"). */
export function firstSampleAt(symbol: StreamSymbol): number | null {
  return rings.get(symbol)?.[0]?.at ?? null;
}
