"use client";

import type { DeckCard, DuelMatchView } from "@kakure/arcade";
import { useState } from "react";
import { useNow } from "@/lib/time";
import { SearchingBanner } from "../art/pixel-art";
import { useGames, useImmersive } from "../games-provider";
import { NicknameSheet } from "../player/nickname-sheet";
import { useNickname } from "../player/player-store";
import { useStanding } from "../player/queries";
import { StageFace } from "../stage/stage-face";
import { type DeckPlace, SwipeDeck } from "../stage/swipe-deck";
import { DUEL } from "./copy";
import { DuelFloor } from "./duel-floor";
import { DuelQueue, DuelResult, SealedWait, Versus } from "./duel-parts";
import { useDuelMatch, useDuelPicks, useDuelState } from "./use-duel";
import "../stage/stage.css";
import "../stage/stage-art.css";
import "./duel.css";

/**
 * `/games/duel` (Mitoshi `duel/DuelStage.tsx`, without the chain arena or pots): find a duel, wait in the queue, meet
 * your opponent, call three live Windows on the swipe deck, wait sealed while both lock in, then watch the cards settle
 * on their Windows' signed outcomes. More right calls wins; Elo moves; nothing is staked.
 */
function seatOf(match: DuelMatchView, nickname: string | null): 0 | 1 | null {
  if (!nickname) return null;
  if (match.seats[0].nickname === nickname) return 0;
  if (match.seats[1].nickname === nickname) return 1;
  return null;
}

export function DuelStage() {
  const { feedback, reducedMotion } = useGames();
  const held = useNickname();
  const standing = useStanding("line-rider");
  const nickname = held ?? standing.data?.nickname ?? null;
  const duel = useDuelState(nickname !== null);
  const matchId = duel.state?.status === "paired" ? duel.state.matchId : null;
  const matchQuery = useDuelMatch(matchId);
  const match = matchQuery.data;
  const seat = match ? seatOf(match, nickname) : null;
  const { picks, pick, error: pickError } = useDuelPicks(match, seat);
  const nowMs = useNow();
  const [nameOpen, setNameOpen] = useState(false);
  const [left, setLeft] = useState<string | null>(null);
  const live = match && (match.status === "picking" || match.status === "revealing");
  useImmersive(Boolean(live) || duel.state?.status === "waiting");

  const find = () => {
    feedback("tap");
    setLeft(null);
    if (!nickname) {
      setNameOpen(true);
      return;
    }
    void duel.find();
  };

  // A finished duel stays on screen until "Duel again"; then the floor.
  const showMatch = match && match.id !== left;
  const cards: DeckCard[] = (match?.deck ?? []).map((card, index) => ({
    index,
    marketId: card.window,
    asset: card.asset,
    intervalSec: card.intervalSec,
    expirySec: card.expirySec,
  }));
  const active =
    match && match.status === "picking" && picks.length < cards.length ? (cards[picks.length] ?? null) : null;
  const opponent = match && seat !== null ? match.seats[seat === 0 ? 1 : 0] : null;

  const face = (card: DeckCard, place: DeckPlace) => (
    <StageFace
      card={card}
      place={place}
      nowMs={nowMs}
      eyebrow={DUEL.pick.eyebrow(card.asset)}
      question={DUEL.pick.question}
      pills={[
        { label: DUEL.pick.closes, value: DUEL.pick.left(match?.pickLeftSec ?? 0), tone: "live" },
        {
          label: DUEL.pick.opponent,
          value: opponent?.committed ? DUEL.pick.opponentIn : DUEL.pick.opponentPicking,
          tone: opponent?.committed ? "up" : undefined,
        },
      ]}
    />
  );

  return (
    <div className="gm-page du-stage">
      {showMatch && seat !== null ? (
        <>
          <Versus match={match} seat={seat} />
          {match.status === "picking" && active ? (
            <SwipeDeck cards={cards} active={active} onPick={(_, side) => pick(side)} renderFace={face} />
          ) : match.status === "picking" || match.status === "revealing" ? (
            <SealedWait match={match} revealing={match.status === "revealing"} />
          ) : (
            <DuelResult
              match={match}
              seat={seat}
              nowMs={nowMs}
              reduced={reducedMotion}
              onAgain={() => setLeft(match.id)}
            />
          )}
          {pickError ? <p className="du-fail">{pickError}</p> : null}
        </>
      ) : duel.state?.status === "waiting" && nickname ? (
        <DuelQueue state={duel.state} nickname={nickname} onLeave={() => void duel.leave()} />
      ) : (
        <section className="du-entry" aria-label={DUEL.title}>
          <div className="du-entry-art" aria-hidden>
            <SearchingBanner className="du-searching-art" />
          </div>
          <button type="button" className="gm-cta du-cta" onClick={find}>
            {nickname ? DUEL.entry.find : DUEL.entry.needName}
          </button>
          <p className="du-note">{duel.error ?? (duel.failed ? DUEL.offline : DUEL.entry.note)}</p>
        </section>
      )}
      {!showMatch || seat === null ? (
        <DuelFloor waiting={duel.state?.waiting ?? null} rating={duel.state?.rating ?? null} />
      ) : null}
      <NicknameSheet open={nameOpen} onClose={() => setNameOpen(false)} onClaimed={() => setNameOpen(false)} />
    </div>
  );
}
