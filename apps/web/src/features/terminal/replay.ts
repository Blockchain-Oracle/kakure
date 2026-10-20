"use client";

import type { LaneAsset, Network } from "@kakure/domain";
import { sharedPrices } from "@kakure/feeds";
import { CANDLES_PATH, type CandlesResponse } from "@kakure/feeds/protocol";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { PRICE_RELAY } from "@/constants";
import { commit, loadEntries, onVaultReset } from "@/features/vault/vault-db";
import { zatToNumber } from "./format";
import type { LivePosition } from "./positions";

/**
 * Trade replays (Owarine `replay.ts`, Tradash's `tradash.replays.v1`): while a position is open on the terminal its price
 * path is sampled every 100 ms, with the live PnL beside each price so a replay shows the PnL the screen showed,
 * halving the resolution past 900 samples. A gap left by a hidden tab is back-filled from the relay's 1-minute candles
 * (every symbol in one answer, PD19) when the tab returns. At most 150 episodes and about 1.5 MB, falling back to the
 * newest 20.
 *
 * Adapted: Owarine keeps episodes in localStorage; here each is an encrypted vault entry (an episode names a position's
 * asset, side and PnL), written when it ends or the tab hides. They stay on this device: backups carry money and
 * positions, not recordings.
 */
export interface Episode {
  /** The position's key. */
  key: string;
  asset: LaneAsset;
  side: "U" | "D";
  cadenceSec: number;
  entrySpot: number | null;
  line: number | null;
  openedAtMs: number;
  closedAtMs: number | null;
  /** [time ms, price, PnL in ZEC]; PnL null where back-filled or unpriced. */
  samples: Array<[number, number, number | null]>;
}

const SAMPLE_MS = 100;
const HALVE_AT = 900;
const MAX_EPISODES = 150;
const MAX_BYTES = 1_500_000;
const FALLBACK_EPISODES = 20;
const MIN_SAMPLES = 30;
const MIN_COVERAGE = 0.6;
/** The middle 80 % of an episode may have no unfilled gap. */
const EDGE = 0.1;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
const CANDLES_MAX = 300;
const CANDLE_SLACK = 2;
/** A gap longer than this is a hole in the recording (the tab was hidden or the stream down): 3 s, or 4 samples. */
const GAP_FLOOR_MS = 3_000;
const GAP_SAMPLES = 4;
export const GAP_MS = Math.max(GAP_FLOOR_MS, GAP_SAMPLES * SAMPLE_MS);

interface Store {
  episodes: Episode[];
  dirty: Set<string>;
  loaded: boolean;
}
const stores = new Map<Network, Store>();
const listeners = new Set<() => void>();

function storeOf(network: Network): Store {
  let s = stores.get(network);
  if (!s) {
    s = { episodes: [], dirty: new Set(), loaded: false };
    stores.set(network, s);
    void loadEntries<Episode>(network, ["episode"])
      .then((entries) => {
        const live = s?.episodes ?? [];
        const saved = entries.map((e) => e.value).filter((e) => !live.some((x) => x.key === e.key));
        if (s) {
          s.episodes = [...live, ...saved].sort((a, b) => b.openedAtMs - a.openedAtMs);
          s.loaded = true;
        }
        notify();
      })
      .catch(() => {
        // A locked or unavailable vault: replays last for this tab.
        if (s) s.loaded = true;
      });
  }
  return s;
}

onVaultReset(() => {
  stores.clear();
  notify();
});

/** A new array reference, so `useSyncExternalStore` readers see the change. */
function notify(): void {
  for (const s of stores.values()) s.episodes = [...s.episodes];
  for (const l of listeners) l();
}

const EMPTY: Episode[] = [];

export function useEpisodes(network: Network): Episode[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => storeOf(network).episodes,
    () => EMPTY,
  );
}

/** Writes the episodes that changed, then trims the oldest past the limits. */
async function persist(network: Network): Promise<void> {
  const s = storeOf(network);
  if (s.dirty.size === 0) return;
  const changed = s.episodes.filter((e) => s.dirty.has(e.key));
  s.dirty.clear();
  let keep = s.episodes.slice(0, MAX_EPISODES);
  if (JSON.stringify(keep).length > MAX_BYTES) keep = keep.slice(0, FALLBACK_EPISODES);
  const dropped = s.episodes.filter((e) => !keep.includes(e));
  s.episodes = keep;
  try {
    await commit(
      network,
      changed.filter((e) => keep.includes(e)).map((e) => ({ type: "episode" as const, key: e.key, value: e })),
      dropped.map((e) => ({ type: "episode" as const, key: e.key })),
    );
  } catch {
    // A locked or full vault: these replays last for this tab.
  }
}

/** Keeps every other sample once there are too many (the first and the last always stay). */
export function halve(samples: Episode["samples"]): Episode["samples"] {
  if (samples.length <= HALVE_AT) return samples;
  const out = samples.filter((_, i) => i % 2 === 0);
  const last = samples.at(-1);
  if (last && out.at(-1) !== last) out.push(last);
  return out;
}

/** How much of the episode's time the samples cover (gaps over `GAP_MS` count as uncovered). */
export function coverage(e: Pick<Episode, "samples">): number {
  const s = e.samples;
  const first = s[0];
  const last = s.at(-1);
  if (!first || !last || s.length < 2) return 0;
  const span = last[0] - first[0];
  if (span <= 0) return 0;
  let covered = 0;
  for (let i = 1; i < s.length; i++) {
    const d = (s[i]?.[0] ?? 0) - (s[i - 1]?.[0] ?? 0);
    if (d <= GAP_MS) covered += d;
  }
  return covered / span;
}

/** Tradash's rule: at least 30 samples, at least 60 % covered, and no unfilled gap in the middle 80 %. */
export function replayable(e: Episode): boolean {
  const s = e.samples;
  const t0 = s[0]?.[0];
  const t1 = s.at(-1)?.[0];
  if (t0 === undefined || t1 === undefined || s.length < MIN_SAMPLES || coverage(e) < MIN_COVERAGE) return false;
  const span = t1 - t0;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]?.[0] ?? 0;
    const b = s[i]?.[0] ?? 0;
    const mid = (a + b) / 2 - t0;
    if (mid > span * EDGE && mid < span * (1 - EDGE) && b - a > GAP_MS) return false;
  }
  return true;
}

/** Linear prices every second across `(from, to)` from 1-minute candles (each close at its minute's end). */
export function interpolateCandles(
  candles: ReadonlyArray<{ t: number; c: number }>,
  from: number,
  to: number,
): Array<[number, number, null]> {
  const points = candles.map((k) => [k.t + MINUTE_MS, k.c] as const).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number, null]> = [];
  for (let t = from + SECOND_MS; t < to; t += SECOND_MS) {
    const j = points.findIndex((p) => p[0] >= t);
    const a = points[j - 1];
    const b = points[j];
    if (j <= 0 || !a || !b) continue;
    out.push([t, a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]), null]);
  }
  return out;
}

async function backfill(network: Network, e: Episode): Promise<void> {
  const last = e.samples.at(-1);
  if (!last || Date.now() - last[0] <= GAP_MS) return;
  const count = Math.min(CANDLES_MAX, Math.ceil((Date.now() - last[0]) / MINUTE_MS) + CANDLE_SLACK);
  try {
    const res = await fetch(`${PRICE_RELAY.replace(/\/$/, "")}${CANDLES_PATH}?interval=1m&count=${count}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as CandlesResponse;
    const rows = body.candles[`${e.asset}-USD`] ?? [];
    const filled = interpolateCandles(
      rows.map(([t, , , , c]) => ({ t, c: Number(c) })),
      last[0],
      Date.now(),
    );
    if (filled.length === 0) return;
    e.samples = halve([...e.samples, ...filled]);
    storeOf(network).dirty.add(e.key);
    notify();
  } catch {
    // The gap stays; the episode says how much it recorded.
  }
}

/**
 * Records every open single on this device at 100 ms while the terminal is open; closes an episode when its position
 * goes; back-fills a hidden-tab gap when the tab returns.
 */
export function useReplayRecorder(
  network: Network,
  positions: readonly LivePosition[],
  references: ReadonlyMap<string, string>,
): void {
  const live = useRef({ positions, references });
  live.current = { positions, references };

  useEffect(() => {
    const s = storeOf(network);
    const stream = sharedPrices();
    const tick = () => {
      const now = Date.now();
      const open = new Set<string>();
      for (const p of live.current.positions) {
        if (p.kind !== "single" || !p.asset || !p.side || !p.cadenceSec || p.status === "buying") continue;
        open.add(p.key);
        const price = Number(stream?.get(`${p.asset}-USD`)?.price ?? Number.NaN);
        if (!Number.isFinite(price)) continue;
        let e = s.episodes.find((x) => x.key === p.key && x.closedAtMs === null);
        if (!e) {
          if (s.episodes.some((x) => x.key === p.key)) continue;
          e = {
            key: p.key,
            asset: p.asset,
            side: p.side,
            cadenceSec: p.cadenceSec,
            entrySpot: p.record.entrySpot ?? null,
            line: null,
            openedAtMs: p.record.certificate ? p.record.certificate.openedAt * SECOND_MS : now,
            closedAtMs: null,
            samples: [],
          };
          s.episodes = [e, ...s.episodes];
        }
        if (e.line === null && p.window) {
          const line = live.current.references.get(p.window.id);
          if (line) e.line = Number(line);
        }
        const last = e.samples.at(-1);
        if (!last || now - last[0] >= SAMPLE_MS) {
          // In place: copying the whole path ten times a second cost more than the sample (Owarine's note).
          e.samples.push([now, price, p.pnlZat === null ? null : zatToNumber(p.pnlZat)]);
          if (e.samples.length > HALVE_AT) e.samples = halve(e.samples);
          s.dirty.add(e.key);
        }
      }
      let closed = false;
      for (const e of s.episodes) {
        if (e.closedAtMs === null && !open.has(e.key)) {
          e.closedAtMs = now;
          s.dirty.add(e.key);
          closed = true;
        }
      }
      // Saved when an episode ends (and when the tab hides), not on a timer while one records.
      if (closed) {
        notify();
        void persist(network);
      }
    };
    const sampler = setInterval(tick, SAMPLE_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        void persist(network);
        return;
      }
      for (const e of s.episodes) if (e.closedAtMs === null) void backfill(network, e);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(sampler);
      document.removeEventListener("visibilitychange", onVisible);
      void persist(network);
    };
  }, [network]);
}

/** The episode behind a history row: the row's id is the position's key, or the key and a reduction (`key:r0`). */
export function episodeFor(all: readonly Episode[], rowId: string): Episode | null {
  return all.find((e) => rowId === e.key || rowId.startsWith(`${e.key}:`)) ?? null;
}
