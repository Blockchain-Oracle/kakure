import { type CueName, REACTION } from "./constants";

/**
 * The position reaction engine (senryo.md §6.4, simplified): it watches one position's underlying price and turns
 * moves into cues. A favourable step climbs the pentatonic ladder (combo), an adverse step resets the climb and,
 * from the second in a row, plays the low blip; a fast move inside the surge window plays a surge or a slump.
 * "Favourable" is relative to the side held: up for Up, down for Down. It never invents a move: no tick, no cue.
 */
export interface Reaction {
  cue: CueName;
  /** Ladder step for the profit cue. */
  step?: number;
  /** Bigger wins inside a throttle bucket. */
  strength: number;
}

export interface ReactionEngine {
  /** Feed every price tick; returns the cue to play, if any. */
  tick(price: number, at: number): Reaction | null;
}

const STRENGTH = { adverse: 1, profit: 2, slump: 5, surge: 6, mega: 7 } as const;

export function createReactionEngine(direction: "up" | "down"): ReactionEngine {
  const sign = direction === "up" ? 1 : -1;
  let last: number | null = null;
  let lastStep: number | null = null;
  let noise = 0;
  let combo = 0;
  let adverse = 0;
  let cooldownUntil = 0;
  const window: Array<{ at: number; price: number }> = [];

  return {
    tick(price, at) {
      if (!Number.isFinite(price) || price <= 0) return null;
      if (last === null || lastStep === null) {
        last = price;
        lastStep = price;
        return null;
      }
      noise = noise === 0 ? Math.abs(price - last) : noise + REACTION.emaAlpha * (Math.abs(price - last) - noise);
      last = price;

      window.push({ at, price });
      while (window.length > 0 && at - (window[0]?.at ?? at) > REACTION.surgeWindowMs) window.shift();
      const oldest = window[0]?.price ?? price;
      const fast = (price - oldest) / oldest;
      if (at >= cooldownUntil && Math.abs(fast) >= REACTION.surgeFraction) {
        cooldownUntil = at + REACTION.cooldownMs;
        lastStep = price;
        const favourable = Math.sign(fast) === sign;
        if (!favourable) return { cue: "slump", strength: STRENGTH.slump };
        return Math.abs(fast) >= REACTION.megaFraction
          ? { cue: "mega", strength: STRENGTH.mega }
          : { cue: "surge", strength: STRENGTH.surge };
      }

      const threshold = Math.min(
        Math.max(REACTION.stepNoiseFactor * noise, REACTION.stepMinFraction * price),
        REACTION.stepMaxFraction * price,
      );
      const moved = price - lastStep;
      if (Math.abs(moved) < threshold) return null;
      lastStep = price;
      if (Math.sign(moved) === sign) {
        combo += 1;
        adverse = 0;
        return { cue: "profit", step: Math.min(REACTION.maxLadderStep, combo - 1), strength: STRENGTH.profit + combo };
      }
      combo = 0;
      adverse += 1;
      return adverse >= REACTION.adverseFrom ? { cue: "adverse", strength: STRENGTH.adverse } : null;
    },
  };
}

/** One cue per 160 ms bucket across every position; the strongest wins ("a climb rather than a buzz"). */
export function createThrottle(play: (reaction: Reaction) => void) {
  let pending: Reaction | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (reaction: Reaction) => {
    if (!pending || reaction.strength > pending.strength) pending = reaction;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const next = pending;
      pending = null;
      if (next) play(next);
    }, REACTION.bucketMs);
  };
}
