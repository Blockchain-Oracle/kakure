import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHopState,
  createRng,
  ENGINE_VERSION,
  FIELD_H,
  HOP,
  MAX_RUN_SEC,
  MAX_RUN_TICKS,
  solvePow,
  stepHop,
  ticksToMs,
} from "@kakure/arcade";
import { publicKeyFor, signDocument } from "@kakure/signing";
import { SEED_GRACE_SEC } from "./constants";
import { acceptScore, readBoard, register } from "./handlers";
import { ArcadeStore } from "./store";

/** A steady bot's Candle Hop run on a seed: kick when below the next gap's middle and falling. */
function play(seed: string) {
  const config = { calm: false };
  const rng = createRng(seed);
  const s = createHopState(rng, config);
  const trace: number[] = [];
  while (!s.over && s.tick < MAX_RUN_TICKS) {
    const next = s.candles.find((c) => c.x + HOP.bodyW / 2 > HOP.coinX - HOP.hitR);
    const press = !s.dying && s.coinY > (next ? next.center : FIELD_H / 2) && s.vy > 0;
    if (press) trace.push(s.tick);
    stepHop(s, press, rng, config);
  }
  return { score: s.score, durationMs: ticksToMs(s.tick), trace };
}

describe("the arcade service", () => {
  const secret = new Uint8Array(32).fill(7);
  const player = Buffer.from(publicKeyFor(secret)).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const grace = MAX_RUN_SEC + SEED_GRACE_SEC;

  it("ranks a replayed run under a claimed nickname, and refuses what it can't reproduce", () => {
    const store = new ArcadeStore(":memory:");
    const nickname = "Steady";
    assert.equal(register(store, signDocument({ player, nickname, nonce: 0 }, secret)).ok, false);
    const claimed = register(store, signDocument({ player, nickname, nonce: solvePow({ player, nickname }) }, secret));
    assert.deepEqual(claimed, { ok: true, body: { nickname } });

    store.issue("0badf00d", "candle-hop", null, now, grace);
    const run = play("0badf00d");
    const claim = {
      game: "candle-hop",
      seed: "0badf00d",
      engineVersion: ENGINE_VERSION["candle-hop"],
      calm: false,
      player,
      ...run,
    };
    const tampered = acceptScore(store, signDocument({ ...claim, score: run.score + 1 }, secret));
    assert.deepEqual(tampered, { ok: false, status: 422, error: "the replay doesn't reproduce that score" });

    store.issue("5eed1234", "candle-hop", null, now, grace);
    const honest = { ...claim, seed: "5eed1234", ...play("5eed1234") };
    const accepted = acceptScore(store, signDocument(honest, secret));
    assert.equal(accepted.ok, true);
    // One score per seed, and a seed this service never issued doesn't rank.
    assert.equal(acceptScore(store, signDocument(honest, secret)).ok, false);
    assert.equal(acceptScore(store, signDocument({ ...honest, seed: "cafebabe" }, secret)).ok, false);
    const board = readBoard(store, "candle-hop", "day");
    assert.deepEqual(
      board.rows.map((r) => r.nickname),
      [nickname],
    );
  });

  it("refuses a claim signed by another key, and a nickname another key holds", () => {
    const store = new ArcadeStore(":memory:");
    const other = new Uint8Array(32).fill(9);
    const nickname = "Taken";
    register(store, signDocument({ player, nickname, nonce: solvePow({ player, nickname }) }, secret));
    const otherPlayer = Buffer.from(publicKeyFor(other)).toString("hex");
    const stolen = { player: otherPlayer, nickname, nonce: solvePow({ player: otherPlayer, nickname }) };
    assert.equal(register(store, signDocument(stolen, other)).ok, false);
    assert.equal(register(store, signDocument({ ...stolen, player }, other)).ok, false);
  });
});
