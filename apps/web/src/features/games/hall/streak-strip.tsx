"use client";

import { ARCADE_GAMES, type ArcadeGame } from "@kakure/arcade";
import { Flame } from "lucide-react";
import Link from "next/link";
import { ARCADE } from "../arcade/copy";
import { GAMES } from "../copy";
import { useNickname } from "../player/player-store";
import { useStanding } from "../player/queries";
import { useDeviceFacts } from "./device-facts";

function ArcadeBest({ game }: { game: ArcadeGame }) {
  const standing = useStanding(game);
  const best = standing.data?.best;
  if (best == null) return null;
  return (
    <Link href={`/games/${game}`} className="streak-chip">
      {GAMES.streak.arcadeBest(ARCADE.games[game].title, ARCADE.fmt(best))}
    </Link>
  );
}

/**
 * The streak strip (Mitoshi `hall/StreakStrip.tsx`, the flame after 21st.dev trophyso/streak-badge): real records only,
 * and only this device's. Mitoshi read a wallet's row off the public leaderboard; here trades are private, so the best
 * streak and win rate come from the calls this device held to the close, and the arcade bests from the service's
 * standing for this device's key, under its nickname.
 */
export function StreakStrip() {
  const { calls } = useDeviceFacts();
  const nickname = useNickname();
  return (
    <section className="streak" aria-label={GAMES.streak.label}>
      <span className="streak-badge" data-on={calls.bestStreak > 0 ? "" : undefined}>
        <Flame aria-hidden className="streak-flame" />
        <span className="streak-n">{calls.bestStreak}</span>
      </span>
      <span className="streak-text">
        {calls.winPct === null ? (
          <span className="streak-sub">{GAMES.streak.noCalls}</span>
        ) : (
          <>
            <span className="streak-main">{GAMES.streak.best(calls.bestStreak)}</span>
            <span className="streak-sub">{GAMES.streak.winRate(calls.winPct)}</span>
          </>
        )}
      </span>
      <span className="streak-bests">
        {ARCADE_GAMES.map((game) => (
          <ArcadeBest key={game} game={game} />
        ))}
        <span className="streak-chip streak-chip--name">
          {nickname ? GAMES.streak.nickname(nickname) : GAMES.streak.pick}
        </span>
      </span>
    </section>
  );
}
