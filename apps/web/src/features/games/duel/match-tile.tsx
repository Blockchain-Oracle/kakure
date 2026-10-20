"use client";

import Link from "next/link";
import { useNickname } from "../player/player-store";
import { DUEL } from "./copy";
import { useDuelMatch, useDuelState } from "./use-duel";
import "./duel-floor.css";

/**
 * The hall's live duel (Mitoshi `duel/MatchTile.tsx`): when this device's nickname is in a live duel, one tap back to
 * it. Nothing when there's none.
 */
export function MatchTile() {
  const nickname = useNickname();
  const duel = useDuelState(nickname !== null);
  const matchId = duel.state?.status === "paired" ? duel.state.matchId : null;
  const match = useDuelMatch(matchId).data;
  if (!match || !nickname) return null;
  const opponent = match.seats[0].nickname === nickname ? match.seats[1] : match.seats[0];
  return (
    <Link href="/games/duel" className="du-tile">
      <span className="du-tile-dot" aria-hidden />
      <span className="du-tile-main">
        <span className="du-tile-title">{DUEL.tile.title}</span>
        <span className="du-tile-sub">{DUEL.tile.vs(opponent.nickname)}</span>
      </span>
      <span className="du-tile-go">{DUEL.tile.resume}</span>
    </Link>
  );
}
