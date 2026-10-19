import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CandleHop, replayHop } from "./candle-hop";
import { LineRider, type RideInput, replayRide } from "./line-rider";
import { tapeFromCloses } from "./tape";

/** A day-like tape: a slow drift with a few sharp moves. */
const closes = Array.from(
  { length: 600 },
  (_, i) => 80_000 + i * 3 + (i % 37 === 0 ? 120 : 0) - (i % 53 === 0 ? 150 : 0),
);
const tape = tapeFromCloses(closes);

/** A player who taps when the coin sinks near the bottom of the next gap: reproducible from the state alone. */
function playHop(seed: number): number[] {
  const game = new CandleHop(seed, tape);
  const taps: number[] = [];
  while (!game.over && game.tick < 3_600) {
    const next = game.candles.find((c) => !c.passed);
    if (next && game.y > next.gapBottom - 25 && game.vy > 0) {
      taps.push(game.tick);
      game.tap();
    }
    game.step();
  }
  return taps;
}

describe("Candle Hop", () => {
  it("replays a recorded run to the same score", () => {
    const taps = playHop(42);
    const a = replayHop(42, tape, taps);
    const b = replayHop(42, tape, taps);
    assert.deepEqual(a, b);
    assert.ok(a.score > 3, `a steady player passes candles (score ${a.score})`);
  });

  it("scores differently when the trace is tampered with", () => {
    const taps = playHop(7);
    const honest = replayHop(7, tape, taps);
    const tampered = replayHop(
      7,
      tape,
      taps.filter((_, i) => i % 3 !== 0),
    );
    assert.notDeepEqual(tampered, honest);
  });

  it("ends a run with no taps on the floor", () => {
    assert.equal(replayHop(1, tape, []).score, 0);
  });
});

describe("Line Rider", () => {
  /** Hold briefly, release (a hop), repeated: a simple deterministic trace. */
  const inputs: RideInput[] = [];
  for (let t = 60; t < 3_000; t += 90) inputs.push([t, true], [t + 20, false]);

  it("replays the same trace to the same score", () => {
    const a = replayRide(9, tape, inputs);
    const b = replayRide(9, tape, inputs);
    assert.deepEqual(a, b);
    assert.ok(a.score > 0);
  });

  it("a different seed lays different terrain", () => {
    const one = new LineRider(1, tape);
    const two = new LineRider(2, tape);
    assert.notDeepEqual(
      one.points.slice(0, 20).map((p) => p.y),
      two.points.slice(0, 20).map((p) => p.y),
    );
  });
});
