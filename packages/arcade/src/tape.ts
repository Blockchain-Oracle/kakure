import { TAPE_MAX_POINTS, TAPE_MIN_POINTS, TAPE_Q } from "./field";
import { seedToUint32 } from "./rng";

/**
 * A run's terrain (Mitoshi `web/src/features/games/arcade/tape.server.ts`, cut from Kakure's signed prints files instead
 * of RedStone prints): the seed picks the feed, and the tape is its 1-minute closes over the last twelve hours, oldest
 * first, at most TAPE_MAX_POINTS of them, evenly sampled. It comes as levels over their own range (0..TAPE_Q, Candle Hop)
 * and as minute-to-minute moves in tenths of a basis point (Line Rider's sled), integers both, from exact decimals, so
 * the browser (the attract loop) and the arcade worker (issuing and replaying runs) cut identical tapes from the same
 * signed files. Fewer than two closes give an empty tape: the run then plays on the seed's own line.
 */
export const TAPE_FEEDS = ["BTC", "ETH"] as const;
export type TapeFeed = (typeof TAPE_FEEDS)[number];
const HOURS = 12;
const HOUR_SEC = 3_600;
export const TAPE_SPAN_SEC = HOURS * HOUR_SEC;
/** 1 = 100 % in tenths of a basis point. */
const TENTH_BP = 100_000n;
const E8_PLACES = 8;
const E8 = 100_000_000n;
const HALF = 2;

export interface Tape {
  feed: TapeFeed;
  fromSec: number;
  toSec: number;
  points: number[];
  moves: number[];
}

/** The feed a seed rides, so a board's runs ride BTC and ETH alike. */
export const feedOf = (seed: string): TapeFeed => TAPE_FEEDS[seedToUint32(seed) % TAPE_FEEDS.length] as TapeFeed;

/** A decimal price as an exact integer in units of 1e-8; null when it isn't a plain positive decimal. */
function decimalE8(text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = (match[2] ?? "").slice(0, E8_PLACES).padEnd(E8_PLACES, "0");
  return BigInt(match[1] as string) * E8 + BigInt(fraction);
}

/**
 * The tape for `feed` ending at `toSec`, from that feed's `[minute start, close]` pairs (its first voting exchange's,
 * as the signed prints files carry them). Minutes outside the twelve hours, missing closes and repeats are skipped.
 */
export function cutTape(feed: TapeFeed, closes: ReadonlyArray<readonly [number, string | null]>, toSec: number): Tape {
  const fromSec = toSec - TAPE_SPAN_SEC;
  const byMinute = new Map<number, bigint>();
  for (const [minute, close] of closes) {
    if (close === null || minute < fromSec || minute >= toSec || byMinute.has(minute)) continue;
    const price = decimalE8(close);
    if (price !== null && price > 0n) byMinute.set(minute, price);
  }
  let prices = [...byMinute.entries()].sort((a, b) => a[0] - b[0]).map(([, price]) => price);
  if (prices.length > TAPE_MAX_POINTS) {
    const stride = prices.length / TAPE_MAX_POINTS;
    const all = prices;
    prices = Array.from({ length: TAPE_MAX_POINTS }, (_, i) => all[Math.floor(i * stride)] as bigint);
  }
  if (prices.length < TAPE_MIN_POINTS) return { feed, fromSec, toSec, points: [], moves: [] };
  const lo = prices.reduce((a, b) => (b < a ? b : a));
  const hi = prices.reduce((a, b) => (b > a ? b : a));
  const span = hi - lo;
  const points = prices.map((p) => (span === 0n ? TAPE_Q / HALF : Number(((p - lo) * BigInt(TAPE_Q)) / span)));
  const moves = prices.slice(1).map((p, i) => {
    const before = prices[i] as bigint;
    return Number(((p - before) * TENTH_BP) / before);
  });
  return { feed, fromSec, toSec, points, moves };
}
