// Ported from Mitoshi (crypto-world-fair@0355c617) sled.test.ts and hop.test.ts, on node:test: a recorded run replays to
// the same score and length on the same tape, the envelope accepts it, the tape shapes the terrain, and Kakure's tape
// cut reads exact decimals.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIELD_H, MAX_RUN_TICKS, STEP_HZ, ticksToMs } from "./field";
import { createHopState, HOP, stepHop } from "./hop";
import { replayHop, replaySled } from "./replay";
import { createRng } from "./rng";
import { sledCode, sledScoreOf, stepSled } from "./sled";
import { createSledState } from "./sled-world";
import { cutTape, TAPE_SPAN_SEC } from "./tape";
import { envelopeCheck, hopScoreCeiling, recordSledInput, sledScoreCeiling } from "./trace";

const SEED = "5eed1234";

describe("the sled", () => {
  const MOVES = Array.from({ length: 120 }, (_, i) => Math.round(40 * Math.sin(i / 6)) + (i % 7) - 3);
  const CONFIG = { calm: false, moves: MOVES };

  it("replays a recorded run to the same score and length, and the run ends", () => {
    const rng = createRng(SEED);
    const s = createSledState(rng, CONFIG);
    const trace: number[] = [];
    while (!s.over && s.tick < MAX_RUN_TICKS) {
      // A steady player: charge for half a second, let go, now and then.
      const code = sledCode(s.tick % 90 < 30, 0);
      recordSledInput(trace, s.tick, code);
      stepSled(s, code, rng, CONFIG);
    }
    assert.equal(s.over, true);
    assert.deepEqual(replaySled(SEED, trace, CONFIG), { score: sledScoreOf(s), ticks: s.tick, ended: true });
    assert.equal(envelopeCheck("line-rider", ticksToMs(s.tick), trace, sledScoreOf(s)).ok, true);
    assert.ok(sledScoreOf(s) <= sledScoreCeiling(s.tick / STEP_HZ));
  });

  it("lays its line from the tape: another tape, another line", () => {
    const a = createSledState(createRng(SEED), CONFIG).pts;
    const b = createSledState(createRng(SEED), { calm: false, moves: MOVES.map((m) => -m) }).pts;
    assert.notDeepEqual(a, b);
  });
});

describe("the canyon", () => {
  const MOVES = Array.from({ length: 90 }, (_, i) => Math.round(25 * Math.sin(i / 4)));
  const CONFIG = { calm: false, moves: MOVES };

  it("replays a recorded run to the same score and length, inside the envelope", () => {
    const rng = createRng(SEED);
    const s = createHopState(rng, CONFIG);
    const trace: number[] = [];
    while (!s.over && s.tick < MAX_RUN_TICKS) {
      // Kick when below the next gap's middle and falling — a steady player.
      const next = s.candles.find((c) => c.x + HOP.bodyW / 2 > HOP.coinX - HOP.hitR);
      const press = !s.dying && s.coinY > (next ? next.center : FIELD_H / 2) && s.vy > 0;
      if (press) trace.push(s.tick);
      stepHop(s, press, rng, CONFIG);
    }
    assert.equal(s.over, true);
    assert.deepEqual(replayHop(SEED, trace, CONFIG), { score: s.score, ticks: s.tick, ended: true });
    assert.equal(envelopeCheck("candle-hop", ticksToMs(s.tick), trace, s.score).ok, true);
    assert.ok(s.score <= hopScoreCeiling(s.tick / STEP_HZ));
  });

  it("lifts the gap on a rising move", () => {
    const up = createHopState(createRng(SEED), { calm: false, moves: Array.from({ length: 30 }, () => 40) });
    const down = createHopState(createRng(SEED), { calm: false, moves: Array.from({ length: 30 }, () => -40) });
    assert.ok((up.candles.at(-1)?.center ?? 0) < (down.candles.at(-1)?.center ?? 0));
    assert.ok(up.candles.every((c) => c.up));
  });

  it("refuses a score no run of that length could reach", () => {
    assert.equal(envelopeCheck("candle-hop", 2_000, [], 1_000).ok, false);
  });
});

describe("the tape", () => {
  it("cuts levels and moves from exact decimals, skipping gaps and old minutes", () => {
    const to = 1_800_000_000;
    const closes: Array<[number, string | null]> = [
      [to - TAPE_SPAN_SEC - 60, "1.00"],
      [to - 180, "100.00"],
      [to - 120, null],
      [to - 60, "101.00"],
      [to - 120, "100.50"],
    ];
    const tape = cutTape("BTC", closes, to);
    assert.deepEqual(tape.points, [0, 500, 1_000]);
    assert.deepEqual(tape.moves, [500, 497]);
    assert.deepEqual(cutTape("ETH", [[to - 60, "5"]], to).points, []);
  });
});
