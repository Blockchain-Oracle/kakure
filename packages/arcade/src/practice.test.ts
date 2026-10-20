import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRACTICE_CARD_MIN_LIFE_SEC,
  PRACTICE_IDLE,
  PRACTICE_WATCH_SEC,
  practiceBotSide,
  practiceScore,
  practiceTransition,
  priceE8,
  selectPracticeDeck,
} from "./practice";

const NOW = 1_800_000_000;

test("the deck deals live Windows that outlast the round, soonest first, five at most", () => {
  const candidates = Array.from({ length: 8 }, (_, i) => ({
    marketId: `w${i}`,
    asset: "BTC",
    intervalSec: 300,
    expirySec: NOW + PRACTICE_CARD_MIN_LIFE_SEC + 10 * (8 - i),
    trading: i !== 3,
  }));
  candidates.push({ marketId: "short", asset: "ETH", intervalSec: 60, expirySec: NOW + 30, trading: true });
  const deck = selectPracticeDeck(candidates, NOW);
  assert.equal(deck.length, 5);
  assert.deepEqual(
    deck.map((c) => c.marketId),
    ["w7", "w6", "w5", "w4", "w2"],
  );
  assert.deepEqual(
    deck.map((c) => c.index),
    [0, 1, 2, 3, 4],
  );
});

test("the coin is a fixed function of the seed and the card, and not the same hand for every seed", () => {
  assert.equal(practiceBotSide("alpha", 0), practiceBotSide("alpha", 0));
  const hand = (seed: string) => [0, 1, 2, 3, 4].map((i) => practiceBotSide(seed, i)).join();
  assert.notEqual(hand("alpha"), hand("beta"));
});

test("a round scores each swiped card on its own close; a missing close stays unscored", () => {
  const cards = selectPracticeDeck(
    [0, 1].map((i) => ({ marketId: `m${i}`, asset: "BTC", intervalSec: 300, expirySec: NOW + 600 + i, trading: true })),
    NOW,
  );
  let round = practiceTransition(PRACTICE_IDLE, { kind: "deal", seed: "s", cards });
  round = practiceTransition(round, { kind: "pick", pick: { cardIndex: 0, side: "up", entryE8: 100n, atMs: 0 } });
  // A double-fired swipe is a no-op.
  round = practiceTransition(round, { kind: "pick", pick: { cardIndex: 0, side: "down", entryE8: 1n, atMs: 1 } });
  round = practiceTransition(round, { kind: "pick", pick: { cardIndex: 1, side: "down", entryE8: 100n, atMs: 500 } });
  assert.equal(round.phase, "watching");
  assert.equal(round.watchEndsAtMs, 500 + PRACTICE_WATCH_SEC * 1000);
  round = practiceTransition(round, { kind: "close", close: { cardIndex: 0, closeE8: 101n } });
  round = practiceTransition(round, { kind: "score" });
  const score = practiceScore(round);
  assert.equal(round.phase, "scored");
  assert.equal(score.cards.length, 1);
  assert.equal(score.cards[0]?.you, "won");
  assert.equal(score.youWon, 1);
});

test("prices parse exactly from the relay's decimals", () => {
  assert.equal(priceE8("67123.45"), 6_712_345_000_000n);
  assert.equal(priceE8("0.000000019"), 1n);
  assert.equal(priceE8("abc"), null);
  assert.equal(priceE8("0"), null);
});
