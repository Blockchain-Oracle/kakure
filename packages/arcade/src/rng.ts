/** 2^32, for turning a 32-bit integer into a float in [0, 1). */
const UINT32 = 4_294_967_296;
const MIX_A = 0x6d2b79f5;
const SHIFT_A = 15;
const SHIFT_B = 7;
const SHIFT_C = 14;
const OR_B = 61;

/**
 * A small seeded generator (the mulberry32 construction): integer operations only, so every engine draws the
 * same sequence from the same seed. Not for secrets; it only lays out terrain and gaps.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + MIX_A) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> SHIFT_A), t | 1);
    t ^= t + Math.imul(t ^ (t >>> SHIFT_B), t | OR_B);
    return ((t ^ (t >>> SHIFT_C)) >>> 0) / UINT32;
  }

  /** An integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}
