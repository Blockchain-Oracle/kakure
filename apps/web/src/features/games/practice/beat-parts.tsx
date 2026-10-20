"use client";

import {
  type DeckCard,
  movePercent,
  type PracticeCardResult,
  type PracticePick,
  type PracticeSide,
  practiceMove,
} from "@kakure/arcade";
import { cadenceLabel } from "@kakure/domain";
import { Mark } from "@kakure/ui-web";
import { ArrowDown, ArrowUp } from "lucide-react";
import { assetFor } from "@/features/markets/assets";
import { CountdownRing } from "../kit/countdown-ring";
import { PRACTICE } from "./copy";

/**
 * Beat the coin's pieces (Mitoshi `practice/BeatParts.tsx`, from Senryo's WarmUpParts): a side as a chip, and one race
 * row (your call against the coin's on the live move since your swipe, who leads it, its own ring to its close),
 * stamped once scored. A lead is not a verdict: nothing is called before the close.
 */
export function SideChip({ side, coin = false }: { side: PracticeSide; coin?: boolean }) {
  const Arrow = side === "up" ? ArrowUp : ArrowDown;
  return (
    <span className="pr-chip" data-side={side} data-coin={coin || undefined} title={PRACTICE.result.call[side]}>
      <Arrow aria-hidden />
    </span>
  );
}

type Lead = "you" | "coin" | "even";

function leaderOf(side: PracticeSide, coin: PracticeSide, entryE8: bigint, nowE8: bigint): Lead {
  if (side === coin) return "even";
  const move = practiceMove(entryE8, nowE8);
  if (move === "flat") return "even";
  return move === side ? "you" : "coin";
}

export function RaceRow({
  card,
  pick,
  coin,
  nowE8,
  result,
  closesAtMs = null,
}: {
  card: DeckCard;
  pick: PracticePick;
  coin: PracticeSide;
  nowE8: bigint | null;
  result: PracticeCardResult | null;
  closesAtMs?: number | null;
}) {
  const move = nowE8 === null ? null : practiceMove(pick.entryE8, nowE8);
  const lead = nowE8 === null ? "even" : leaderOf(pick.side, coin, pick.entryE8, nowE8);
  const info = assetFor({ kind: "close", subject: card.asset });
  return (
    <li className="pr-race">
      <Mark mark={info.mark} label={card.asset} size="token" />
      <span className="pr-race-name">
        <span className="pr-race-asset">{card.asset}</span>
        <span className="pr-race-move" data-move={move ?? "flat"}>
          {nowE8 === null ? "—" : `${movePercent(pick.entryE8, nowE8)} · ${cadenceLabel(card.intervalSec)}`}
        </span>
      </span>
      <span className="pr-race-sides">
        <SideChip side={pick.side} />
        <SideChip side={coin} coin />
      </span>
      {!result && closesAtMs ? <CountdownRing startMs={pick.atMs} endMs={closesAtMs} size="sm" /> : null}
      {result ? (
        <span className="pr-race-stamp" data-result={result}>
          {PRACTICE.result.cardResult[result]}
        </span>
      ) : (
        <span className="pr-race-lead" data-lead={lead}>
          {lead === "you"
            ? `${PRACTICE.versus.you} ${PRACTICE.watch.leader}`
            : lead === "coin"
              ? `${PRACTICE.versus.coin} ${PRACTICE.watch.leader}`
              : PRACTICE.result.tied}
        </span>
      )}
    </li>
  );
}
