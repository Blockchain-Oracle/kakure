// Ported from Mitoshi (crypto-world-fair@0355c617) packages/core/src/games/arcade/rng.ts, Kakure's design authority for
// the arcade (plan §0 R4). The engine is unchanged; its tape comes from Kakure's signed prints files (`tape.ts`).
/**
 * The arcade's dice: xorshift32, seeded from eight hex characters.
 *
 * Pips's engines draw their line and their candles from `Math.random`, which is exactly the thing a
 * replay cannot have. Every draw here comes from a generator whose whole state is one 32-bit word, so a
 * seed and the inputs that followed it reproduce a run to the tick — on the browser that played it and
 * on the server that checks it. The generator is deliberately the simplest one that is good enough
 * for a scrolling line: eleven operations, no allocation, no dependency.
 *
 * A seed is a string on the wire and in the database so it is never mistaken for a count, and eight
 * lowercase hex characters so it is exactly the 32 bits the generator holds — no more, no less.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
}

const SEED_PATTERN = /^[0-9a-f]{8}$/;
/** xorshift never leaves zero, so a zero seed takes this constant instead — a fact, not a defect. */
const ZERO_SEED_STAND_IN = 0x9e3779b9;
const HEX = 16;
const SEED_HEX_CHARS = 8;
const SEED_BYTES = 4;
/** 2^32: the generator's 32-bit state as a fraction of its range, in [0, 1). */
const UINT32_RANGE = 4_294_967_296;

export function isArcadeSeed(value: string): boolean {
  return SEED_PATTERN.test(value);
}

export function seedFromUint32(word: number): string {
  return (word >>> 0).toString(HEX).padStart(SEED_HEX_CHARS, "0");
}

export function seedToUint32(seed: string): number {
  if (!isArcadeSeed(seed)) throw new Error(`not an arcade seed: ${seed}`);
  return Number.parseInt(seed, HEX) >>> 0;
}

/** A seed from any four bytes the caller has — `crypto.getRandomValues` in a browser, `randomBytes` on a server. */
export function seedFromBytes(bytes: Uint8Array): string {
  if (bytes.length < SEED_BYTES) throw new Error("an arcade seed needs four bytes");
  const word =
    ((bytes[0] as number) << 24) | ((bytes[1] as number) << 16) | ((bytes[2] as number) << 8) | (bytes[3] as number);
  return seedFromUint32(word);
}

export function createRng(seed: string): Rng {
  let state = seedToUint32(seed) || ZERO_SEED_STAND_IN;
  return {
    next() {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / UINT32_RANGE;
    },
  };
}
