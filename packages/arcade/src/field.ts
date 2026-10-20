// Ported from Mitoshi (crypto-world-fair@0355c617) packages/core/src/games/arcade/field.ts, Kakure's design authority for
// the arcade (plan §0 R4). The engine is unchanged; its tape comes from Kakure's signed prints files (`tape.ts`).
/**
 * The arcade's fixed world.
 *
 * Both engines simulate a 640×360 field at 60 steps a second, whatever the canvas that draws them
 * measures. That is what makes a run replayable: Pips's engines step on the frame's `dt` and read the
 * canvas's own width to decide how many line points or candles exist, so the same inputs on a phone and
 * a monitor produce different runs — and a server has no canvas at all. Here a run is a seed and a list
 * of inputs by tick, and the field they played on is this file.
 *
 * Nothing here calls `Math.sin`, `Math.exp` or `Math.pow`: those are not required to agree bit for bit
 * across JavaScript engines, and a score that replays to a different number on the server than in the
 * browser is a refused score. Every operation in the simulation is `+ − × ÷`, `min`, `max`, `abs`,
 * `floor` and `round`, which IEEE 754 fixes exactly.
 */
export const FIELD_W = 640;
export const FIELD_H = 360;
export const STEP_HZ = 60;
const MS_PER_SEC = 1_000;
export const STEP_SEC = 1 / STEP_HZ;
export const STEP_MS = MS_PER_SEC / STEP_HZ;

/** The longest run the server will replay. A trace past this is refused, never accepted on its envelope alone. */
const MAX_RUN_MIN = 30;
const SEC_PER_MIN = 60;
export const MAX_RUN_SEC = MAX_RUN_MIN * SEC_PER_MIN;
export const MAX_RUN_TICKS = MAX_RUN_SEC * STEP_HZ;

/** The ride's wheel is quantised to a byte before it enters the trace, so the trace is compact and the replay exact. */
export const TARGET_Q_MAX = 255;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export type ArcadeGame = "line-rider" | "candle-hop";

export const ARCADE_GAMES: readonly ArcadeGame[] = ["line-rider", "candle-hop"];

export function isArcadeGame(value: string): value is ArcadeGame {
  return value === "line-rider" || value === "candle-hop";
}

/**
 * The one option a run carries besides its seed. Reduced motion offers the calmer ramp — a slower
 * climb to full difficulty — and because the ramp is the mechanic, the replay has to know. It is
 * recorded with the score and the board says which runs took it.
 */
export interface ArcadeRunConfig {
  calm: boolean;
  /**
   * Engine v2 (R4-9, D-227): the run's terrain as a server-issued tape — real prices normalised over the tape's own
   * range to 0..TAPE_Q (TAPE_Q = the tape's high). Line Rider rides it; Candle Hop cuts its gaps from it. Absent, the
   * seed draws the terrain (a guest's run, or a deployment without an index). The server replays against the tape it
   * stored for the seed, so the run it checks is the run that was played.
   */
  tape?: readonly number[];
  /**
   * Line Rider's sled terrain (v3, ported from Senryo): the same prints as moves — each print's change from the one
   * before, in tenths of a basis point. The sled normalises them over their own mean, so a calm tape still rides.
   */
  moves?: readonly number[];
}

/** A tape point's scale: 0 is the tape's low, TAPE_Q its high. */
export const TAPE_Q = 1_000;
/** A tape needs two points to have a slope; the server issues at most this many. */
export const TAPE_MIN_POINTS = 2;
export const TAPE_MAX_POINTS = 480;

/** A tape too short to have a slope sits at the middle of its range. */
const MID_RANGE = 0.5;

/** The tape's value at a fractional index, played forward then back (ping-pong), as 0..1 of its range. */
export function tapeAt(tape: readonly number[], at: number): number {
  const n = tape.length;
  if (n < TAPE_MIN_POINTS) return MID_RANGE;
  const period = 2 * (n - 1);
  let p = ((at % period) + period) % period;
  if (p > n - 1) p = period - p;
  const i = Math.min(n - 2, Math.floor(p));
  const f = p - i;
  return ((tape[i] as number) + ((tape[i + 1] as number) - (tape[i] as number)) * f) / TAPE_Q;
}

export function ticksToMs(ticks: number): number {
  return Math.round((ticks * MS_PER_SEC) / STEP_HZ);
}

export function msToTicks(ms: number): number {
  return Math.round((ms * STEP_HZ) / MS_PER_SEC);
}
