/**
 * Writes fixtures/lanes.json: lane ids, Window starts and ids, and settlement cases computed by this (reference)
 * package. The Rust operator's tests read the same file (services/operator/src/lanes.rs, settle.rs), so both sides
 * must agree. Run: pnpm --filter @kakure/domain lanes-vectors
 */
import { writeFileSync } from "node:fs";
import type { VenueKey } from "../src/constants";
import { currentAndNext, LANES, laneById, parseWindowId, windowStartAt } from "../src/lanes";
import { compareDecimal, outcomeOf, referenceOf } from "../src/settle";

const AT = [1_792_400_000, 1_792_400_059, 1_792_400_160, 1_792_406_399, 1_792_454_400];
const VENUES: VenueKey[] = ["coinbase", "kraken", "bitstamp"];

const windows = LANES.flatMap((lane) =>
  AT.map((at) => {
    const [now, next] = currentAndNext(lane, at);
    return { lane: lane.id, at, start: windowStartAt(lane, at), id: now.id, expiry: now.expirySec, next: next.id };
  }),
);

const parse = [
  "btc-5m+3-1792400280",
  "eth-1d-1792368000",
  "btc-2m+1-1792400161",
  "btc-7m-1792400160",
  "sol-1h-179240",
].map((id) => ({ id, valid: parseWindowId(id) !== null }));

const compare = [
  ["103.330", "103.33"],
  ["103.33", "103.329"],
  ["0.1", "0.10000001"],
  ["82614", "82614.0"],
  ["9", "10"],
].map(([a, b]) => ({ a, b, order: compareDecimal(a as string, b as string) }));

const cases: Array<{ opening: Record<string, string | null>; closing: Record<string, string | null> }> = [
  {
    opening: { coinbase: "100.00", kraken: "100.1", bitstamp: "99.9" },
    closing: { coinbase: "100.01", kraken: "100.2", bitstamp: "99.8" },
  },
  {
    opening: { coinbase: "100.00", kraken: "100.1", bitstamp: "99.9" },
    closing: { coinbase: "99.99", kraken: "100.0", bitstamp: "100.0" },
  },
  {
    opening: { coinbase: "100", kraken: "100", bitstamp: "100" },
    closing: { coinbase: "100.0", kraken: "101", bitstamp: "99" },
  },
  {
    opening: { coinbase: "100", kraken: null, bitstamp: "100" },
    closing: { coinbase: "101", kraken: "101", bitstamp: "99" },
  },
  { opening: { coinbase: "100", kraken: "100" }, closing: { coinbase: "101", kraken: "101" } },
  { opening: {}, closing: {} },
];
const settle = cases.map((c) => ({
  ...c,
  outcome: outcomeOf(VENUES, c.opening, c.closing),
  reference: referenceOf(VENUES, c.opening),
}));

const lanes = LANES.map((lane) => ({
  id: lane.id,
  asset: lane.asset,
  cadenceSec: lane.cadenceSec,
  phaseSec: lane.phaseSec,
}));
if (!laneById("btc-2m+1")) throw new Error("expected the staggered 2m lane");

writeFileSync(
  new URL("../fixtures/lanes.json", import.meta.url),
  `${JSON.stringify({ lanes, windows, parse, compare, settle }, null, 2)}\n`,
);
console.log(`lanes.json: ${lanes.length} lanes, ${windows.length} windows, ${settle.length} settlement cases`);
