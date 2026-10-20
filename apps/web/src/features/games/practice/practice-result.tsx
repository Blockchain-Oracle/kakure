"use client";

import type { PracticeRound, PracticeScore } from "@kakure/arcade";
import { RollingNumber } from "@kakure/ui-web";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { tradeHref } from "@/features/markets/live-lanes";
import { useGames } from "../games-provider";
import { ConfettiBurst } from "../kit/confetti";
import { RaceRow } from "./beat-parts";
import { PRACTICE } from "./copy";

const REVEAL_MS = 220;

/** The reveal (Senryo's WarmUpScreen): one card each 220 ms with its verdict's cue, then the score. */
export function useReveal(score: PracticeScore | null): number {
  const { feedback } = useGames();
  const [shown, setShown] = useState(0);
  const cue = useRef(feedback);
  cue.current = feedback;
  const total = score?.cards.length ?? 0;
  useEffect(() => {
    if (!score) {
      setShown(0);
      return;
    }
    if (shown > total) return;
    const t = window.setTimeout(() => {
      const c = score.cards[shown];
      if (c) cue.current(c.you === "won" ? "card-win" : c.you === "lost" ? "card-loss" : "click");
      else cue.current(score.winner === "you" ? "duel-win" : score.winner === "bot" ? "duel-lose" : "modal-open");
      setShown((n) => n + 1);
    }, REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [score, shown, total]);
  return shown;
}

/**
 * The scoreboard (Mitoshi `practice/PracticeResult.tsx`): a count of cards and nothing else, since practice writes no
 * money, rank or streak. A card the feed couldn't price at its close is counted in one line, never scored flat. The
 * onward step is the same call with a stake: the round's best card on the terminal.
 */
export function PracticeResult({
  round,
  score,
  shown,
  onAgain,
}: {
  round: PracticeRound;
  score: PracticeScore;
  shown: number;
  onAgain: () => void;
}) {
  const { reducedMotion } = useGames();
  const unscored = round.picks.length - score.cards.length;
  const done = shown > score.cards.length;
  const verdict =
    score.winner === "you" ? PRACTICE.result.won : score.winner === "bot" ? PRACTICE.result.lost : PRACTICE.result.tied;
  const best = score.cards.find((c) => c.you === "won") ?? score.cards[0];
  const real = best ?? null;

  return (
    <section className="pr-watch" aria-label={PRACTICE.result.title}>
      <ConfettiBurst fire={done && score.winner === "you"} reduced={reducedMotion} />
      <div className="pr-score" data-winner={done ? (score.winner ?? "tie") : undefined}>
        <div className="pr-score-side">
          <span className="pr-score-k">{PRACTICE.result.you}</span>
          <RollingNumber value={String(done ? score.youWon : 0)} className="pr-score-v" />
        </div>
        <span className="pr-score-dash" aria-hidden>
          —
        </span>
        <div className="pr-score-side">
          <span className="pr-score-k">{PRACTICE.result.bot}</span>
          <RollingNumber value={String(done ? score.botWon : 0)} className="pr-score-v" />
        </div>
        {done ? (
          <p className="pr-score-verdict pr-stamp" aria-live="polite">
            {verdict}
          </p>
        ) : null}
      </div>

      <ul className="pr-races">
        {score.cards.slice(0, shown).map((c) => {
          const pick = round.picks.find((p) => p.cardIndex === c.card.index);
          return pick ? (
            <RaceRow key={c.card.index} card={c.card} pick={pick} coin={c.botSide} nowE8={c.closeE8} result={c.you} />
          ) : null;
        })}
      </ul>

      {done ? (
        <>
          <p className="pr-foot">
            {[
              score.cards.some((c) => c.move === "flat") ? PRACTICE.result.flatNote : null,
              unscored > 0 ? PRACTICE.result.unscored(unscored) : null,
              PRACTICE.result.botNote,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="pr-cta-row">
            <button type="button" className="gm-cta" onClick={onAgain}>
              {PRACTICE.result.again}
            </button>
            <Link href="/games/line-rider" className="gm-cta gm-cta--quiet">
              {PRACTICE.result.toArcade}
            </Link>
          </div>
          {real ? (
            <Link
              href={tradeHref(real.card.asset as Parameters<typeof tradeHref>[0], real.card.intervalSec)}
              className="pr-real"
            >
              {PRACTICE.result.toReal}
            </Link>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
