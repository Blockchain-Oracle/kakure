import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseLuckyWindow,
  drawLucky,
  eligibleLuckyWindows,
  luckyBestStreak,
  luckyCandidateHash,
  luckyStreak,
  mapLuckyDraw,
  unbiasedIndex,
} from "./lucky";

const HASH = "a".repeat(64);
const candidates = ["BTC", "ETH", "SOL"].map((asset, i) => ({
  id: `${asset.toLowerCase()}-5m-${1_800_000_000 + i}`,
  asset,
  intervalSec: 300,
  expirySec: 1_800_000_300,
  trading: true,
}));

test("the draw is a pure function of the bundle hash, the seed and the candidates", () => {
  const a = drawLucky({ bundleHash: HASH, seed: "01", candidates });
  const b = drawLucky({ bundleHash: HASH, seed: "01", candidates: [...candidates].reverse() });
  assert.deepEqual(a, b);
  const seen = new Set(
    Array.from({ length: 40 }, (_, i) =>
      JSON.stringify(drawLucky({ bundleHash: HASH, seed: `${i}`, candidates }).draw),
    ),
  );
  assert.ok(seen.size > 5, "different seeds draw different things");
});

test("the candidate hash ignores order and repeats", () => {
  assert.equal(luckyCandidateHash(["b", "a", "a"]), luckyCandidateHash(["a", "b"]));
  assert.notEqual(luckyCandidateHash(["a"]), luckyCandidateHash(["a", "b"]));
});

test("indexes skip the bytes that would bias them", () => {
  // 255 is past 255 - 255 % 5 = 255's limit for n = 5 (limit 255), so it's skipped; 7 % 5 = 2.
  assert.deepEqual(unbiasedIndex(Uint8Array.from([255, 7]), 0, 5), { index: 2, cursor: 2 });
  assert.equal(mapLuckyDraw(Uint8Array.from([1, 0, 4]), ["A", "B"]).asset, "B");
});

test("eligibility needs headroom, and the reach picks the closest ask", () => {
  const now = 1_800_000_000;
  assert.equal(eligibleLuckyWindows(candidates, now + 250).length, 0);
  assert.equal(eligibleLuckyWindows(candidates, now).length, 3);
  const pick = chooseLuckyWindow(
    [
      { askE4: 5_000, expirySec: 2 },
      { askE4: 1_100, expirySec: 3 },
      { askE4: 900, expirySec: 1 },
    ],
    10,
  );
  assert.equal(pick?.askE4, 900);
});

test("streaks count wins, skip refunds and closes, and stop at a loss", () => {
  const rows = ["won", "refund", "won", "lost", "won"].map((result) => ({ result: result as "won" }));
  assert.equal(luckyStreak(rows), 2);
  assert.equal(luckyBestStreak([...rows].reverse()), 2);
});
