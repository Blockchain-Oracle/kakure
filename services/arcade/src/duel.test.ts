import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type DuelPick, duelCommitment, INITIAL_RATING } from "@kakure/arcade";
import { publicKeyFor, signDocument } from "@kakure/signing";
import { commitPicks, leaveQueue, matchView, revealPicks } from "./duel";
import type { MatchRow } from "./duel-store";
import { ArcadeStore } from "./store";

const now = () => Math.floor(Date.now() / 1000);
const keyOf = (secret: Uint8Array) => Buffer.from(publicKeyFor(secret)).toString("hex");
const SALT = "00112233445566778899aabbccddeeff";
const PICKS: DuelPick[] = ["up", "down", "up"];

describe("the Duel service", () => {
  const secretA = new Uint8Array(32).fill(3);
  const secretB = new Uint8Array(32).fill(4);
  const a = keyOf(secretA);
  const b = keyOf(secretB);

  function match(store: ArcadeStore, overrides: Partial<MatchRow>): MatchRow {
    const card = { window: "btc-5m-1800000000", asset: "BTC", intervalSec: 300, expirySec: now() + 600 };
    const m: MatchRow = {
      id: "0123456789abcdef0123456789abcdef",
      a,
      b,
      deck: [card, card, card],
      status: "picking",
      pickDeadline: now() + 60,
      revealDeadline: null,
      commits: [null, null],
      picks: [null, null],
      outcomes: [null, null, null],
      winner: null,
      deltas: [null, null],
      ratings: [INITIAL_RATING, INITIAL_RATING],
      day: 20_261_020,
      ...overrides,
    };
    store.duels.create(m);
    store.duels.save(m);
    return m;
  }

  const commit = (secret: Uint8Array, player: string, matchId: string) =>
    signDocument(
      {
        action: "commit",
        player,
        matchId,
        commitment: duelCommitment({ matchId, player, picks: PICKS, salt: SALT }),
        at: now(),
      },
      secret,
    );

  it("applies a forfeit once, however many late calls and polls reach it", () => {
    const store = new ArcadeStore(":memory:");
    const m = match(store, {
      pickDeadline: now() - 1,
      commits: [duelCommitment({ matchId: "x", player: a, picks: PICKS, salt: SALT }), null],
    });
    for (let i = 0; i < 3; i++) {
      const late = commitPicks(store, commit(secretB, b, m.id));
      assert.deepEqual(late, { ok: false, status: 409, error: "the picks are closed" });
    }
    matchView(store, m.id);
    matchView(store, m.id);
    const view = matchView(store, m.id);
    assert.equal(view?.status, "forfeit");
    assert.equal(view?.winner, 0);
    assert.deepEqual(
      view?.seats.map((s) => s.delta),
      [0, -24],
    );
    // The present player is credited the win without rating; the absent one loses rating, once.
    assert.deepEqual({ ...store.duels.rating(a) }, { rating: INITIAL_RATING, verified: 0, won: 1, finished: 1 });
    assert.deepEqual({ ...store.duels.rating(b) }, { rating: 976, verified: 1, won: 0, finished: 1 });
  });

  it("hides picks until both reveal, and holds each player to their commitment", () => {
    const store = new ArcadeStore(":memory:");
    const m = match(store, {});
    assert.equal(commitPicks(store, commit(secretA, a, m.id)).ok, true);
    const both = commitPicks(store, commit(secretB, b, m.id));
    assert.equal(both.ok && both.body.status, "revealing");
    const reveal = (secret: Uint8Array, player: string, picks: DuelPick[]) =>
      revealPicks(
        store,
        signDocument({ action: "reveal", player, matchId: m.id, picks, salt: SALT, at: now() }, secret),
      );
    assert.equal(reveal(secretA, a, ["down", "down", "down"]).ok, false);
    const first = reveal(secretA, a, PICKS);
    assert.equal(first.ok && first.body.seats[0].picks, null);
    const second = reveal(secretB, b, PICKS);
    assert.equal(second.ok && second.body.status, "settling");
    assert.deepEqual(second.ok && second.body.seats[0].picks, PICKS);
  });

  it("refuses a signed request sent as another call, or for a duel that isn't yours", () => {
    const store = new ArcadeStore(":memory:");
    const queue = signDocument({ action: "queue", player: a, at: now() }, secretA);
    assert.equal(leaveQueue(store, queue).ok, false);
    const m = match(store, {});
    const outsider = new Uint8Array(32).fill(5);
    const stranger = commitPicks(store, commit(outsider, keyOf(outsider), m.id));
    assert.deepEqual(stranger, { ok: false, status: 404, error: "no such duel of yours" });
  });
});
