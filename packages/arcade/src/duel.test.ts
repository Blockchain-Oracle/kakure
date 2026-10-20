import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDuelResult,
  dealDuelDeck,
  duelCommitment,
  duelScore,
  findOpponent,
  INITIAL_RATING,
  searchBand,
} from "./duel";

const NOW = 1_800_000_000;

test("the search band widens with waiting and caps", () => {
  assert.equal(searchBand(0), 100);
  assert.equal(searchBand(31), 200);
  assert.equal(searchBand(10_000), 400);
});

test("the queue pairs the longest-waiting compatible player, never yourself", () => {
  const me = { player: "a", rating: 1000, queuedAt: NOW };
  const queue = [
    { player: "a", rating: 1000, queuedAt: NOW - 100 },
    { player: "b", rating: 1500, queuedAt: NOW - 50 },
    { player: "c", rating: 1080, queuedAt: NOW - 10 },
    { player: "d", rating: 950, queuedAt: NOW - 20 },
  ];
  assert.equal(findOpponent(me, queue, NOW)?.player, "d");
});

test("the deck is three live Windows on different assets, soonest first, inside the horizon", () => {
  const w = (id: string, asset: string, left: number, trading = true) => ({
    id,
    asset,
    intervalSec: 300,
    expirySec: NOW + left,
    trading,
  });
  const deck = dealDuelDeck(
    [
      w("a1", "BTC", 400),
      w("a2", "BTC", 600),
      w("b", "ETH", 500),
      w("c", "SOL", 700),
      w("x", "ZEC", 100),
      w("y", "XRP", 9_000),
    ],
    NOW,
    30,
  );
  assert.deepEqual(
    deck.map((c) => c.id),
    ["a1", "b", "c"],
  );
  assert.deepEqual(dealDuelDeck([w("a1", "BTC", 400)], NOW, 30), []);
});

test("a commitment binds the match, the player, the picks and the salt", () => {
  const base = { matchId: "m", player: "p", picks: ["up", "down", "up"] as const, salt: "s" };
  const c = duelCommitment(base);
  assert.equal(c, duelCommitment({ ...base }));
  assert.notEqual(c, duelCommitment({ ...base, picks: ["up", "up", "up"] }));
  assert.notEqual(c, duelCommitment({ ...base, player: "q" }));
});

test("the score counts right calls, skips refunds, and draws on a tie", () => {
  assert.deepEqual(duelScore(["up", "up", "down"], ["down", "up", "up"], ["U", "D", "D"]), { a: 2, b: 0, score: 1 });
  assert.equal(duelScore(["up", null, "up"], ["up", "down", "up"], ["U", "refund", "U"]).score, 0.5);
  assert.equal(duelScore(["up"], ["down"], ["refund"]).score, null);
});

test("Elo moves both players, a newcomer at double weight", () => {
  const fresh = { rating: INITIAL_RATING, verified: 0 };
  const old = { rating: INITIAL_RATING, verified: 20 };
  const next = applyDuelResult(fresh, old, 1);
  assert.equal(next.a.rating, 1024);
  assert.equal(next.b.rating, 988);
  assert.equal(next.a.verified, 1);
});
