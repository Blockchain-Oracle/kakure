import { type ArcadeGame, seedFromBytes } from "@kakure/arcade";

/**
 * What the stage hands a canvas, and what the canvas hands back (Mitoshi `arcade/run.ts`). A run is a seed, the calm
 * flag and the tape the seed was issued with; `id` lets the same seed be played again. What comes back is the whole
 * claim the arcade service checks: the seed, the flag, the score the HUD showed, the run's length and every input.
 */
export interface ArcadeRun {
  id: number;
  seed: string;
  calm: boolean;
  /** The signed-prints tape issued with the seed (closes, scaled); absent, the seed draws its own line. */
  tape?: readonly number[];
  /** The same prints as moves (tenths of a basis point): Line Rider's terrain and Candle Hop's candles. */
  moves?: readonly number[];
  tapeMeta?: { feed: string; fromSec: number; toSec: number };
}

export interface RunEnd {
  game: ArcadeGame;
  seed: string;
  calm: boolean;
  score: number;
  ticks: number;
  durationMs: number;
  trace: number[];
}

const SEED_BYTES = 4;

/** A seed from the browser's own entropy: for the attract loops and for a run that posts nothing. */
export function localSeed(): string {
  return seedFromBytes(globalThis.crypto.getRandomValues(new Uint8Array(SEED_BYTES)));
}
