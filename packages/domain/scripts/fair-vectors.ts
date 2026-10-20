/**
 * Writes fixtures/fair.json: the house's prices computed by this (reference) package. The Rust operator's tests read
 * the same file (services/operator/src/fair.rs), so a quote, a payout or a parlay price is the same number on both
 * sides. Run: pnpm --filter @kakure/domain fair-vectors
 */
import { writeFileSync } from "node:fs";
import {
  bandInProbability,
  closeValueZat,
  fairUp,
  normalCdf,
  parlayPayoutZat,
  parlayPriceE8,
  parlaySettledZat,
  quoteBand,
  quoteSide,
  quoteWindow,
  reduceShare,
  sidePayoutZat,
  withSlippage,
} from "../src/fair";
import { bandOutcomeOf } from "../src/settle";

const cdf = [-8, -6, -2.5, -1, -0.3, 0, 0.3, 1, 2.5, 6, 8].map((z) => ({ z, p: normalCdf(z) }));

const fair = [
  { spot: 67_012.5, reference: 66_950.1, sigma: 0.45, secondsLeft: 45 },
  { spot: 67_012.5, reference: 66_950.1, sigma: 0.45, secondsLeft: 5 },
  { spot: 67_012.5, reference: 66_950.1, sigma: 0.45, secondsLeft: 2 },
  { spot: 66_900, reference: 66_950.1, sigma: 0.45, secondsLeft: 86_400 },
  { spot: 0.12345, reference: 0.123, sigma: 1.2, secondsLeft: 120 },
  { spot: 3_120.55, reference: 3_120.55, sigma: 0.6, secondsLeft: 600 },
  { spot: 71_000, reference: 66_950.1, sigma: 0.2, secondsLeft: 60 },
  { spot: 58.31, reference: 58.4, sigma: 2.5, secondsLeft: 14_400 },
].map((input) => {
  const pUp = fairUp(input.spot, input.reference, input.sigma, input.secondsLeft);
  return { ...input, pUp, up: quoteSide(pUp), down: quoteSide(1 - pUp) };
});

const sides = [0.5, 0.955, 0.9551, 0.9549, 0.045, 0.0449, 0.0451, 0.0001, 0.9999, 0.123456789].map((p) => ({
  p,
  ...quoteSide(p),
}));

const window = { startSec: 1_792_400_160, expirySec: 1_792_400_220 };
const windows = [
  { now: 1_792_400_100, state: null },
  { now: 1_792_400_163, state: null },
  { now: 1_792_400_170, state: { reference: "66950.1" } },
  { now: 1_792_400_189, state: { reference: "66950.1" } },
  { now: 1_792_400_190, state: { reference: "66950.1" } },
  { now: 1_792_400_230, state: { reference: "66950.1", outcome: "U" } },
].map(({ now, state }) => ({
  now,
  state,
  spot: 67_012.5,
  sigma: 0.45,
  quote: quoteWindow(window, state, { spot: 67_012.5, sigma: 0.45 }, now),
}));

const payouts = [100_000, 123_000, 1_000_000, 10_000_000, 100_000_000].flatMap((stake) =>
  [5_250, 9_800, 300, 7_777].map((askE4) => {
    const payout = sidePayoutZat(stake, askE4);
    return {
      stake,
      askE4,
      payout,
      closes: [200, 4_750, 9_550].map((bidE4) => ({ bidE4, value: closeValueZat(payout, bidE4) })),
    };
  }),
);

const slippage = [
  { priceE4: 5_250, bps: 100, direction: "up" as const },
  { priceE4: 5_250, bps: 100, direction: "down" as const },
  { priceE4: 9_799, bps: 500, direction: "up" as const },
  { priceE4: 201, bps: 50, direction: "down" as const },
].map((c) => ({ ...c, result: withSlippage(c.priceE4, c.bps, c.direction) }));

const legSets = [
  [
    { askE4: 5_250, expirySec: 1_792_400_220 },
    { askE4: 5_250, expirySec: 1_792_400_280 },
  ],
  [
    { askE4: 5_250, expirySec: 1_792_400_220 },
    { askE4: 6_100, expirySec: 1_792_400_220 },
  ],
  [
    { askE4: 5_250, expirySec: 1_792_400_220 },
    { askE4: 3_333, expirySec: 1_792_400_280 },
    { askE4: 7_001, expirySec: 1_792_400_520 },
  ],
  [
    { askE4: 300, expirySec: 1_792_400_220 },
    { askE4: 300, expirySec: 1_792_400_280 },
  ],
  [{ askE4: 5_250, expirySec: 1_792_400_220 }],
];
const parlays = legSets.map((legs) => {
  const price = parlayPriceE8(legs);
  return { legs, price, payout: price.ok ? parlayPayoutZat(10_000_000, price.priceE8) : null };
});

const threeLegs = legSets[2] ?? [];
const settled = (
  [
    ["won", "won", "won"],
    ["won", "lost", "won"],
    ["won", "refund", "won"],
    ["refund", "refund", "won"],
    ["refund", "refund", "refund"],
  ] as const
).map((outcomes) => ({
  stake: 10_000_000,
  legs: threeLegs.map((leg, i) => ({ ...leg, outcome: outcomes[i] ?? "refund" })),
  value: parlaySettledZat(
    10_000_000,
    threeLegs.map((leg, i) => ({ ...leg, outcome: outcomes[i] ?? "refund" })),
  ),
}));

const reductions = [
  [4_764_000, 5_734_000, 4_750],
  [4_764_000, 5_734_000, 5_000],
  [4_764_000, 5_734_000, 9_999],
  [4_764_000, 5_734_000, 10_000],
  [2_378_106, 2_867_000, 2_500],
  [100_000, 1_001_000, 9_990],
  [100_000_000, 123_456_000, 1],
].map(([stake = 0, payout = 0, fractionBps = 0]) => ({
  stake,
  payout,
  fractionBps,
  ...reduceShare(stake, payout, fractionBps),
}));

const bands = [
  { spot: 81_300, lo: 81_250, hi: 81_350, sigma: 0.45, secondsLeft: 300 },
  { spot: 81_300, lo: 81_000, hi: 81_600, sigma: 0.45, secondsLeft: 3_600 },
  { spot: 81_300, lo: 82_000, hi: null, sigma: 0.45, secondsLeft: 900 },
  { spot: 81_300, lo: null, hi: 80_500, sigma: 0.45, secondsLeft: 900 },
  { spot: 0.0789, lo: 0.078, hi: 0.08, sigma: 1.1, secondsLeft: 120 },
  { spot: 2_380, lo: 2_379, hi: 2_381, sigma: 0.6, secondsLeft: 2 },
].map((b) => {
  const edges = { lo: b.lo, hi: b.hi };
  return {
    ...b,
    pIn: bandInProbability(b.spot, edges, b.sigma, b.secondsLeft),
    in: quoteBand(b.spot, edges, "in", b.sigma, b.secondsLeft),
    out: quoteBand(b.spot, edges, "out", b.sigma, b.secondsLeft),
  };
});

const venues = ["coinbase", "kraken", "bitstamp"] as const;
const bandVotes = [
  { closing: { coinbase: "81300.5", kraken: "81299", bitstamp: "81301" }, lo: "81250", hi: "81350" },
  { closing: { coinbase: "81350", kraken: "81350.00", bitstamp: "81351" }, lo: "81250", hi: "81350" },
  { closing: { coinbase: "81360", kraken: null, bitstamp: "81300" }, lo: "81250", hi: "81350" },
  { closing: { coinbase: "82000", kraken: "81999.99", bitstamp: "82100" }, lo: "82000", hi: null },
  { closing: { coinbase: null, kraken: null, bitstamp: "81000" }, lo: null, hi: "81500" },
].map((v) => ({ ...v, venues, outcome: bandOutcomeOf(venues, v.closing, v.lo, v.hi) }));

writeFileSync(
  new URL("../fixtures/fair.json", import.meta.url),
  `${JSON.stringify({ cdf, fair, sides, window, windows, payouts, slippage, parlays, settled, reductions, bands, bandVotes }, null, 2)}\n`,
);
console.log(
  `fair.json: ${cdf.length} Φ, ${fair.length} fair, ${sides.length} sides, ${windows.length} windows, ${payouts.length} payouts, ${parlays.length + settled.length} parlays`,
);
