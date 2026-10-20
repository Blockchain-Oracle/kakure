"use client";

import { type DeckCard, type PracticeCardResult, type PracticePick, practiceBotSide } from "@kakure/arcade";
import { Mark } from "@kakure/ui-web";
import { assetFor } from "@/features/markets/assets";
import { CountdownRing } from "../kit/countdown-ring";
import { SideChip } from "./beat-parts";
import { CardLine } from "./card-line";
import { PRACTICE } from "./copy";
import "./deck-strip.css";

/**
 * Practice's deck as a strip (Mitoshi `stage/DeckStrip.tsx`, from 21st.dev uilayout's moveable thumbnails): five tiles;
 * an upcoming card shows its asset and its half-hour line, the active one widens and lifts with "Now", a swiped one your
 * call, the coin's flipping in and its own 30 s ring, a scored one its stamp, one whose price was missing says so.
 */
export type TileResult = PracticeCardResult | "unscored" | null;

const S = PRACTICE.strip;
const MS = 1000;

export function DeckStrip({
  seed,
  cards,
  picks,
  active,
  closesAtMs,
  results,
  nowMs,
}: {
  seed: string;
  cards: readonly DeckCard[];
  picks: readonly PracticePick[];
  active: DeckCard | null;
  closesAtMs: (cardIndex: number) => number | null;
  results: readonly TileResult[];
  nowMs: number;
}) {
  return (
    <ol className="ds" aria-label={S.label}>
      {cards.map((card, i) => {
        const pick = picks.find((p) => p.cardIndex === card.index);
        const result = results[card.index] ?? null;
        const closes = closesAtMs(card.index);
        const state = result
          ? result === "unscored"
            ? "unscored"
            : "scored"
          : pick
            ? "racing"
            : card.index === active?.index
              ? "active"
              : "upcoming";
        const coin = practiceBotSide(seed, card.index);
        const leftSec = closes && nowMs > 0 ? Math.max(0, Math.ceil((closes - nowMs) / MS)) : null;
        const label =
          state === "active"
            ? S.tile.active(card.asset, i + 1, cards.length)
            : state === "racing" && pick
              ? S.tile.racing(card.asset, pick.side, coin, leftSec)
              : state === "scored" && result && result !== "unscored"
                ? S.tile.scored(card.asset, result)
                : state === "unscored"
                  ? S.tile.unscored(card.asset)
                  : S.tile.upcoming(card.asset, i + 1, cards.length);
        const info = assetFor({ kind: "close", subject: card.asset });
        return (
          <li
            key={card.index}
            className="ds-tile"
            data-state={state}
            data-side={pick?.side}
            data-result={result ?? undefined}
            aria-current={state === "active" ? "step" : undefined}
            aria-label={label}
          >
            <Mark mark={info.mark} label={card.asset} size="inline" />
            {state === "upcoming" || state === "active" ? (
              <>
                <span className="ds-ticker">{card.asset}</span>
                <span className="ds-line" aria-hidden>
                  <CardLine asset={card.asset} />
                </span>
                {state === "active" ? <span className="ds-now">{S.now}</span> : null}
              </>
            ) : state === "racing" && pick && closes ? (
              <>
                <span className="ds-calls">
                  <SideChip side={pick.side} />
                  <span key={`coin-${card.index}`} className="pr-coin-flip">
                    <SideChip side={coin} coin />
                  </span>
                </span>
                <CountdownRing startMs={pick.atMs} endMs={closes} size="sm" />
              </>
            ) : state === "scored" && result && result !== "unscored" ? (
              <span className="ds-stamp" data-result={result}>
                {PRACTICE.result.cardResult[result]}
              </span>
            ) : (
              <span className="ds-none">{S.noPrice}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
