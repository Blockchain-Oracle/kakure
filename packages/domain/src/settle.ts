import type { VenuePrices } from "./bundle-v2";
import { type VenueKey, VOTES_TO_DECIDE } from "./constants";

/**
 * How a Window settles (plan §00, PD20), exactly as the operator does it (`services/operator/src/settle.rs`):
 * each venue votes by comparing its closing print with its opening print (Up, Down or Flat; no vote without both);
 * two of three Up or Down decide; anything else refunds every position at cost. Prices compare as exact decimals
 * ("103.330" equals "103.33"), never as floats.
 */
export type Vote = "U" | "D" | "flat" | null;
export type Outcome = "U" | "D" | "refund";

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const TEN = 10n;

function scaled(value: string, places: number): bigint {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`not a decimal: ${value}`);
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(places, "0");
  return BigInt(whole) * TEN ** BigInt(places) + BigInt(fraction || "0");
}

/** -1, 0 or 1 for two decimal strings. */
export function compareDecimal(a: string, b: string): number {
  const places = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const x = scaled(a, places);
  const y = scaled(b, places);
  return x === y ? 0 : x > y ? 1 : -1;
}

export function vote(opening: string | null | undefined, closing: string | null | undefined): Vote {
  if (!opening || !closing) return null;
  const order = compareDecimal(closing, opening);
  return order > 0 ? "U" : order < 0 ? "D" : "flat";
}

export function outcomeOf(venues: readonly VenueKey[], opening: VenuePrices, closing: VenuePrices): Outcome {
  const votes = venues.map((venue) => vote(opening[venue], closing[venue]));
  const up = votes.filter((v) => v === "U").length;
  const down = votes.filter((v) => v === "D").length;
  if (up >= VOTES_TO_DECIDE) return "U";
  if (down >= VOTES_TO_DECIDE) return "D";
  return "refund";
}

/**
 * The line the price formula uses: the median of the opening prints that had trades, the lower middle one when there
 * are two (always a price a venue actually printed). Null with no print at all.
 */
export function referenceOf(venues: readonly VenueKey[], opening: VenuePrices): string | null {
  const prints = venues
    .map((venue) => opening[venue])
    .filter((p): p is string => typeof p === "string")
    .sort(compareDecimal);
  if (prints.length === 0) return null;
  return prints[Math.floor((prints.length - 1) / 2)] ?? null;
}
