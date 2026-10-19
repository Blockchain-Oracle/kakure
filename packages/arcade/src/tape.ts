/**
 * A price tape: real 1-minute closes (from the operator's signed history files), turned into relative moves.
 * Moves are normalised by the tape's own mean absolute move, so a calm day and a wild day both play, and the
 * terrain or canyon keeps each day's real shape: a rally climbs, a dump drops.
 */
export interface Tape {
  /** Relative moves, each divided by the tape's mean absolute move (so the mean |move| is 1). */
  moves: number[];
  /** Whether each move was up (for drawing candles mint or rose). */
  up: boolean[];
}

/** The smallest mean move used for normalising, so a perfectly flat tape doesn't divide by zero. */
const FLAT_FLOOR = 1e-9;

export function tapeFromCloses(closes: ReadonlyArray<number>): Tape {
  const raw: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1] as number;
    const next = closes[i] as number;
    raw.push(prev > 0 ? (next - prev) / prev : 0);
  }
  let total = 0;
  for (const move of raw) total += Math.abs(move);
  const mean = Math.max(FLAT_FLOOR, raw.length > 0 ? total / raw.length : 0);
  return { moves: raw.map((move) => move / mean), up: raw.map((move) => move >= 0) };
}

/** The move at position `i`, wrapping so a run never runs out of tape. */
export function moveAt(tape: Tape, i: number): number {
  if (tape.moves.length === 0) return 0;
  return tape.moves[i % tape.moves.length] as number;
}
