import { type CueName, REACTION } from "./constants";

/**
 * The trade reaction engine (Owarine `feedback/reactions.ts`; Tradash's combo / surge / slump / callouts). Fed the
 * price of the market on screen at the commit rate (≤ 5 Hz) with the open position on it, it returns what to play and
 * show. Pure apart from the pick among callout texts (the random source is injectable).
 *
 * A binary position has no liquidation price: its "line" is the Window's reference, where a close on the wrong side
 * pays nothing, so Tradash's "Near liquidation" is "Near the line".
 */
export interface ReactionPosition {
  /** Changes when a new position starts. */
  key: string;
  /** +1 for Up, −1 for Down. */
  side: 1 | -1;
  /** Live PnL and what was staked (its ROI base). */
  pnl: number;
  margin: number;
  entry: number;
  /** The level that loses the position (the Window's reference); null when unknown. */
  line: number | null;
}

export type CalloutTone = "good" | "great" | "epic" | "bad" | "warn";

export type Reaction =
  | { kind: "step"; favorable: boolean; count: number }
  | { kind: "surge"; favorable: boolean; mega: boolean }
  | { kind: "callout"; tone: CalloutTone; emoji: string; text: string };

type Pool = ReadonlyArray<readonly [string, string]>;

export const CALLOUTS = {
  combo3: [
    ["👍", "Nice"],
    ["😎", "Smooth"],
    ["✨", "Sweet"],
    ["👌", "Clean"],
  ],
  combo6: [
    ["🎯", "Perfect"],
    ["💪", "Strong"],
    ["🙌", "Beautiful"],
    ["😤", "Let's go"],
  ],
  comboEpic: [
    ["🔥", "On fire!"],
    ["⚡", "Unstoppable"],
    ["🤑", "Printing!"],
    ["👑", "Masterclass"],
  ],
  surge: [
    ["🚀", "Incredible!"],
    ["🚀", "Sending it!"],
    ["💥", "Massive move!"],
    ["🤯", "Unreal!"],
  ],
  mega: [
    ["🌕", "To the moon!"],
    ["🚀", "INSANE!"],
  ],
  adverse: [
    ["😬", "Uhh…"],
    ["😕", "Uhnnn"],
    ["🫤", "Hmm"],
    ["🙃", "Not like this"],
  ],
  slump: [
    ["🥲", "Ouch"],
    ["😵", "Yikes"],
    ["📉", "Rough"],
  ],
  newHigh: [
    ["💎", "New high"],
    ["📈", "New peak"],
  ],
  comeback: [
    ["😮‍💨", "Back in green"],
    ["🙏", "Phew"],
  ],
  nearLine: [["⚠️", "Near the line"]],
} as const satisfies Record<string, Pool>;

/** ROI milestones, each called once per position. */
const MILESTONES: ReadonlyArray<{ roi: number; tone: CalloutTone; emoji: string; text: string }> = [
  { roi: 0.1, tone: "good", emoji: "💰", text: "+10%" },
  { roi: 0.25, tone: "great", emoji: "🤑", text: "+25%!" },
  { roi: 0.5, tone: "epic", emoji: "🏆", text: "+50%!" },
  { roi: 1, tone: "epic", emoji: "💯", text: "Doubled!" },
  { roi: 2, tone: "epic", emoji: "🐐", text: "Tripled!" },
];

const RANK: Record<CalloutTone, number> = { good: 0, bad: 0, great: 1, epic: 2, warn: 2 };
const TOP_RANK = 2;
/** How long each callout stays up (Tradash: good/bad 1.5 s, great 1.8 s, epic 2.2 s, warn 2.6 s). */
export const CALLOUT_LIFETIME_MS: Record<CalloutTone, number> = {
  good: 1_500,
  bad: 1_500,
  great: 1_800,
  epic: 2_200,
  warn: 2_600,
};

interface PositionState {
  key: string;
  openedAt: number;
  anchor: number;
  combo: number;
  adverse: number;
  milestones: number;
  peak: number;
  newHighArmed: boolean;
  comebackArmed: boolean;
  nearLineArmed: boolean;
}

type Candidate = { tone: CalloutTone; pool: Pool } | { tone: CalloutTone; emoji: string; text: string };

export class ReactionEngine {
  private baseline = 0;
  private samples = 0;
  private lastPrice: number | null = null;
  private window: Array<{ t: number; p: number }> = [];
  private lastSurgeAt = Number.NEGATIVE_INFINITY;
  private lastCalloutAt = Number.NEGATIVE_INFINITY;
  private lastCalloutText = "";
  private pos: PositionState | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  /** A new market: forget its noise level and every per-position state. */
  reset(): void {
    this.baseline = 0;
    this.samples = 0;
    this.lastPrice = null;
    this.window = [];
    this.lastSurgeAt = Number.NEGATIVE_INFINITY;
    this.pos = null;
  }

  feed(input: { t: number; price: number; position: ReactionPosition | null }): Reaction[] {
    const { t, price, position } = input;
    if (!(price > 0)) return [];
    this.observe(t, price);
    if (!position) {
      this.pos = null;
      return [];
    }
    const roi = position.margin > 0 ? position.pnl / position.margin : 0;
    if (!this.pos || this.pos.key !== position.key) {
      this.pos = {
        key: position.key,
        openedAt: t,
        anchor: price,
        combo: 0,
        adverse: 0,
        milestones: MILESTONES.filter((m) => roi >= m.roi).length,
        peak: position.pnl,
        newHighArmed: false,
        comebackArmed: roi <= REACTION.comebackFromRoi,
        nearLineArmed: true,
      };
    }
    const s = this.pos;
    const out: Reaction[] = [];
    const callouts: Candidate[] = [];

    // Steps: a move of ~2.5× typical noise since the last step, either way.
    const threshold = Math.min(
      Math.max(REACTION.stepNoiseFactor * this.baseline, REACTION.stepMinFraction * price),
      REACTION.stepMaxFraction * price,
    );
    const move = (price - s.anchor) * position.side;
    if (Math.abs(move) >= threshold) {
      s.anchor = price;
      if (move > 0) {
        s.combo += 1;
        s.adverse = 0;
        out.push({ kind: "step", favorable: true, count: s.combo });
        if (position.pnl > 0) {
          if (s.combo === REACTION.comboGood) callouts.push({ tone: "good", pool: CALLOUTS.combo3 });
          else if (s.combo === REACTION.comboGreat) callouts.push({ tone: "great", pool: CALLOUTS.combo6 });
          else if (s.combo >= REACTION.comboEpicFrom && s.combo % REACTION.comboEpicEvery === 0) {
            callouts.push({ tone: "epic", pool: CALLOUTS.comboEpic });
          }
        }
      } else {
        s.adverse += 1;
        s.combo = 0;
        out.push({ kind: "step", favorable: false, count: s.adverse });
        if (s.adverse === REACTION.adverseCallout) callouts.push({ tone: "bad", pool: CALLOUTS.adverse });
      }
    }

    // Surges: a move far outside the noise inside 1.5 s.
    if (this.samples >= REACTION.surgeMinSamples && t - this.lastSurgeAt >= REACTION.surgeCooldownMs) {
      const surge = this.detectSurge(price);
      if (surge) {
        this.lastSurgeAt = t;
        const favorable = Math.sign(surge.delta) === position.side;
        out.push({ kind: "surge", favorable, mega: surge.mega });
        callouts.push(
          favorable
            ? { tone: "epic", pool: surge.mega ? CALLOUTS.mega : CALLOUTS.surge }
            : { tone: "bad", pool: CALLOUTS.slump },
        );
      }
    }

    // ROI milestones, each once per position.
    for (let m = MILESTONES[s.milestones]; m && roi >= m.roi; m = MILESTONES[s.milestones]) {
      callouts.push({ tone: m.tone, emoji: m.emoji, text: m.text });
      s.milestones += 1;
    }

    // A new high after a real drawdown; a comeback from −3 %.
    if (s.peak > 0 && position.pnl <= REACTION.newHighDrawdown * s.peak) s.newHighArmed = true;
    if (position.pnl > s.peak) {
      if (s.newHighArmed && roi > REACTION.newHighMinRoi) callouts.push({ tone: "great", pool: CALLOUTS.newHigh });
      s.newHighArmed = false;
      s.peak = position.pnl;
    }
    if (roi <= REACTION.comebackFromRoi) s.comebackArmed = true;
    else if (s.comebackArmed && position.pnl > 0) {
      s.comebackArmed = false;
      callouts.push({ tone: "good", pool: CALLOUTS.comeback });
    }

    // Near the line: within a quarter of the entry-to-line distance (re-arms past 40 %).
    if (position.line !== null) {
      const span = Math.max(Math.abs(position.entry - position.line), REACTION.nearLineMinSpanFraction * price);
      const room = ((price - position.line) * position.side) / span;
      if (room < REACTION.nearLineRoom && room > 0 && s.nearLineArmed) {
        s.nearLineArmed = false;
        callouts.push({ tone: "warn", pool: CALLOUTS.nearLine });
      } else if (room > REACTION.nearLineRearm) s.nearLineArmed = true;
    }

    const shown = this.gate(t, s, callouts);
    if (shown) out.push(shown);
    return out;
  }

  private observe(t: number, price: number): void {
    if (this.lastPrice !== null) {
      const d = Math.abs(price - this.lastPrice);
      this.baseline = this.samples === 0 ? d : this.baseline + REACTION.emaAlpha * (d - this.baseline);
      this.samples += 1;
    }
    this.lastPrice = price;
    this.window.push({ t, p: price });
    while (this.window.length > 0 && t - (this.window[0]?.t ?? t) > REACTION.surgeWindowMs) this.window.shift();
  }

  private detectSurge(price: number): { delta: number; mega: boolean } | null {
    const w = this.window;
    const first = w[0];
    const last = w.at(-1);
    if (!first || !last || w.length < REACTION.surgeMinPoints || this.baseline <= 0) return null;
    if (last.t - first.t < REACTION.surgeMinSpanMs) return null;
    const delta = price - first.p;
    const rel = Math.abs(delta) / price;
    const z = Math.abs(delta) / (this.baseline * Math.sqrt(w.length - 1));
    if (z >= REACTION.megaZ && rel >= REACTION.megaFraction) return { delta, mega: true };
    if (z >= REACTION.surgeZ && rel >= REACTION.surgeFraction) return { delta, mega: false };
    return null;
  }

  private gate(t: number, s: PositionState, candidates: Candidate[]): Reaction | null {
    if (candidates.length === 0 || t - s.openedAt < REACTION.calloutQuietMs) return null;
    const best = candidates.reduce((a, b) => (RANK[b.tone] > RANK[a.tone] ? b : a));
    const cooldown = RANK[best.tone] >= TOP_RANK ? REACTION.calloutCooldownTopMs : REACTION.calloutCooldownMs;
    if (t - this.lastCalloutAt < cooldown) return null;
    let emoji: string;
    let text: string;
    if ("pool" in best) {
      const options = best.pool.length > 1 ? best.pool.filter(([, x]) => x !== this.lastCalloutText) : best.pool;
      const pick = options[Math.floor(this.random() * options.length) % options.length] ?? options[0];
      if (!pick) return null;
      [emoji, text] = pick;
    } else ({ emoji, text } = best);
    this.lastCalloutAt = t;
    this.lastCalloutText = text;
    return { kind: "callout", tone: best.tone, emoji, text };
  }
}

/** The cue a step or surge plays (callouts are seen, not heard); null for a lone adverse step. */
export interface ReactionCue {
  cue: CueName;
  step?: number;
  /** Bigger wins inside a throttle bucket. */
  strength: number;
}

const STRENGTH = { adverse: 1, profit: 2, slump: 5, surge: 6, mega: 7 } as const;

export function cueFor(reaction: Reaction): ReactionCue | null {
  if (reaction.kind === "step") {
    if (reaction.favorable) {
      return {
        cue: "profit",
        step: Math.min(REACTION.maxLadderStep, reaction.count - 1),
        strength: STRENGTH.profit + reaction.count,
      };
    }
    return reaction.count >= REACTION.adverseFrom ? { cue: "adverse", strength: STRENGTH.adverse } : null;
  }
  if (reaction.kind === "surge") {
    if (!reaction.favorable) return { cue: "slump", strength: STRENGTH.slump };
    return reaction.mega ? { cue: "mega", strength: STRENGTH.mega } : { cue: "surge", strength: STRENGTH.surge };
  }
  return null;
}

/** One cue per 160 ms bucket across several positions; the strongest wins ("a climb rather than a buzz"). */
export function createThrottle(play: (cue: ReactionCue) => void) {
  let pending: ReactionCue | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (cue: ReactionCue) => {
    if (!pending || cue.strength > pending.strength) pending = cue;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const next = pending;
      pending = null;
      if (next) play(next);
    }, REACTION.bucketMs);
  };
}
