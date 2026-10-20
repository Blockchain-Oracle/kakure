// Ported from Mitoshi (crypto-world-fair@0355c617) packages/core/src/games/arcade/replay.ts, trimmed to the boards'
// engines (Line Rider's sled, Candle Hop's canyon).
import { type ArcadeGame, type ArcadeRunConfig, MAX_RUN_TICKS } from "./field";
import { createHopState, stepHop } from "./hop";
import { createRng } from "./rng";
import { sledScoreOf, stepSled } from "./sled";
import { createSledState } from "./sled-world";
import type { HopTrace, SledTrace } from "./trace";

/**
 * A run, played again from its seed and its inputs — the server's whole check.
 *
 * The browser records what it did; the server does the same thing with the same dice and looks at the number. A run
 * that ends where the browser said it ended, on the score the browser said, is a run that happened. It does not prove
 * the browser was not driven by a script — nothing in a browser can — which is why the board says "server-checked"
 * and no money ever rides on these scores.
 *
 * After the last recorded input the code holds and the button is silent, and the run plays out to its end on its own.
 * So a replay always finishes, and one that is still running at the budget is refused rather than trusted.
 */
export interface ReplayResult {
  score: number;
  ticks: number;
  /** False when the run had not ended by the replay budget — never a score to accept. */
  ended: boolean;
}

/** Line Rider, the sled: the code holds from its tick until the next pair; it opens at 0. */
export function replaySled(seed: string, trace: SledTrace, config: ArcadeRunConfig): ReplayResult {
  const rng = createRng(seed);
  const state = createSledState(rng, config);
  let cursor = 0;
  let code = 0;
  while (!state.over && state.tick < MAX_RUN_TICKS) {
    while (cursor < trace.length && (trace[cursor] as number) === state.tick) {
      code = trace[cursor + 1] as number;
      cursor += 2;
    }
    stepSled(state, code, rng, config);
  }
  return { score: sledScoreOf(state), ticks: state.tick, ended: state.over };
}

/** Candle Hop, the canyon: a press is a tick in the trace. */
export function replayHop(seed: string, trace: HopTrace, config: ArcadeRunConfig): ReplayResult {
  const rng = createRng(seed);
  const state = createHopState(rng, config);
  let cursor = 0;
  while (!state.over && state.tick < MAX_RUN_TICKS) {
    let press = false;
    while (cursor < trace.length && (trace[cursor] as number) === state.tick) {
      press = true;
      cursor += 1;
    }
    stepHop(state, press, rng, config);
  }
  return { score: state.score, ticks: state.tick, ended: state.over };
}

/** The server's replay: Line Rider is the sled, Candle Hop the canyon. */
export function replayArcade(
  game: ArcadeGame,
  seed: string,
  trace: readonly number[],
  config: ArcadeRunConfig,
): ReplayResult {
  return game === "line-rider" ? replaySled(seed, trace, config) : replayHop(seed, trace, config);
}
