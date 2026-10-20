"use client";

import { type PracticeRound, practiceBotSide, priceE8 } from "@kakure/arcade";
import { useEffect } from "react";
import { useGames } from "../games-provider";
import { RaceRow } from "./beat-parts";
import { PRACTICE } from "./copy";

const BEEP_FROM_SEC = 5;

/**
 * The races after the last swipe (Mitoshi `practice/PracticeWatch.tsx`): one countdown to the round's end and each race
 * its own ring to its own close. A lead isn't a verdict; the last five seconds count down out loud. A card whose price
 * can't be read shows a dash, never its entry.
 */
export function PracticeWatch({
  round,
  leftSec,
  priceOf,
  closesAtMs,
}: {
  round: PracticeRound;
  leftSec: number;
  priceOf: (asset: string) => string | null;
  closesAtMs: (cardIndex: number) => number | null;
}) {
  const { feedback } = useGames();
  useEffect(() => {
    if (leftSec > 0 && leftSec <= BEEP_FROM_SEC) feedback("click");
  }, [leftSec, feedback]);

  return (
    <section className="pr-watch" aria-label={PRACTICE.watch.label}>
      <div className="pr-watch-head">
        <h2 className="pr-watch-title">{PRACTICE.watch.label}</h2>
        <span className="pr-watch-clock" role="timer" data-last={leftSec <= BEEP_FROM_SEC || undefined}>
          {PRACTICE.watch.left(leftSec)}
        </span>
      </div>
      <ul className="pr-races">
        {[...round.picks]
          .sort((a, b) => a.cardIndex - b.cardIndex)
          .map((pick) => {
            const card = round.cards.find((c) => c.index === pick.cardIndex);
            if (!card) return null;
            const closed = round.closes.some((c) => c.cardIndex === pick.cardIndex);
            return (
              <RaceRow
                key={pick.cardIndex}
                card={card}
                pick={pick}
                coin={practiceBotSide(round.seed, pick.cardIndex)}
                nowE8={priceE8(priceOf(card.asset) ?? undefined)}
                result={null}
                closesAtMs={closed ? null : closesAtMs(pick.cardIndex)}
              />
            );
          })}
      </ul>
    </section>
  );
}
