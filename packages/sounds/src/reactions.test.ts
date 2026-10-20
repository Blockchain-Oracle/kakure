import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Reaction, ReactionEngine, type ReactionPosition } from "./reactions";

/** Owarine `feedback/reactions.test.ts`, on node:test. */
const TICK_MS = 200;
const BASE = 100_000;
const pos = (o: Partial<ReactionPosition> = {}): ReactionPosition => ({
  key: "k",
  side: 1,
  pnl: 0,
  margin: 100,
  entry: BASE,
  line: null,
  ...o,
});

/** Feeds a calm market (±1 alternating) for `n` ticks at 200 ms. */
function warm(e: ReactionEngine, n: number, start = BASE, t0 = 0, position: ReactionPosition | null = null) {
  for (let i = 0; i < n; i++) e.feed({ t: t0 + i * TICK_MS, price: start + (i % 2), position });
  return t0 + n * TICK_MS;
}

const callouts = (rs: Reaction[]) => rs.filter((x) => x.kind === "callout");

describe("ReactionEngine", () => {
  it("is silent with no position", () => {
    const e = new ReactionEngine(() => 0);
    warm(e, 20);
    assert.deepEqual(e.feed({ t: 10_000, price: 100_500, position: null }), []);
  });

  it("climbs a combo on favourable steps and resets on an adverse one", () => {
    const e = new ReactionEngine(() => 0);
    let t = warm(e, 20);
    const steps: number[] = [];
    let p = BASE;
    for (let i = 0; i < 4; i++) {
      p += 10;
      t += TICK_MS;
      for (const x of e.feed({ t, price: p, position: pos({ pnl: 1 + i }) })) {
        if (x.kind === "step") steps.push(x.favorable ? x.count : -x.count);
      }
    }
    // The first sight sets the anchor; the next three moves are steps.
    assert.deepEqual(steps, [1, 2, 3]);
    t += TICK_MS;
    const back = e.feed({ t, price: p - 10, position: pos({ pnl: 1 }) }).find((x) => x.kind === "step");
    assert.deepEqual(back, { kind: "step", favorable: false, count: 1 });
  });

  it("fires a surge after enough samples, then cools down for 3 s", () => {
    const e = new ReactionEngine(() => 0);
    let t = warm(e, 30);
    const position = pos();
    t += TICK_MS;
    const all = [...e.feed({ t, price: BASE, position })];
    for (let i = 1; i <= 8; i++) {
      t += TICK_MS;
      all.push(...e.feed({ t, price: BASE + i * 12, position }));
    }
    // One favourable surge in the ramp; the rest of it falls inside the 3 s cooldown.
    assert.deepEqual(
      all.filter((x) => x.kind === "surge"),
      [{ kind: "surge", favorable: true, mega: false }],
    );
    t += 3_200;
    const down = e.feed({ t, price: 99_900, position });
    assert.equal(
      down.some((x) => x.kind === "surge" && !x.favorable),
      false,
    );
  });

  it("gates callouts: quiet for 1.2 s, then a milestone shows", () => {
    const e = new ReactionEngine(() => 0);
    let t = warm(e, 20);
    t += TICK_MS;
    assert.deepEqual(callouts(e.feed({ t, price: BASE, position: pos({ pnl: 0 }) })), []);
    t += TICK_MS;
    assert.deepEqual(callouts(e.feed({ t, price: BASE + 1, position: pos({ pnl: 11 }) })), []);
    t += 1_500;
    assert.deepEqual(callouts(e.feed({ t, price: BASE + 1, position: pos({ pnl: 26 }) })), [
      { kind: "callout", tone: "great", emoji: "🤑", text: "+25%!" },
    ]);
  });

  it("pre-counts milestones already passed when a position is first seen", () => {
    const e = new ReactionEngine(() => 0);
    let t = warm(e, 20);
    t += TICK_MS;
    e.feed({ t, price: BASE, position: pos({ pnl: 60 }) });
    t += 2_000;
    assert.deepEqual(callouts(e.feed({ t, price: BASE, position: pos({ pnl: 60 }) })), []);
  });

  it("warns near the line once, and re-arms past 40 %", () => {
    const e = new ReactionEngine(() => 0);
    let t = warm(e, 20);
    const line = { entry: 100_100, line: BASE };
    t += TICK_MS;
    e.feed({ t, price: 100_100, position: pos(line) });
    t += 1_500;
    const warn = e.feed({ t, price: 100_020, position: pos(line) }).find((x) => x.kind === "callout");
    assert.equal(warn?.kind === "callout" && warn.tone, "warn");
    assert.equal(warn?.kind === "callout" && warn.text, "Near the line");
    t += 1_000;
    assert.equal(
      e.feed({ t, price: 100_019, position: pos(line) }).some((x) => x.kind === "callout"),
      false,
    );
  });
});
