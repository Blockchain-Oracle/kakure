"use client";

import { buttonClass } from "@kakure/ui-web";
import Link from "next/link";
import { BoardsView } from "@/features/games/rank/boards-view";

/**
 * `/leaderboard` (Mitoshi's LeaderboardScreen, Masayume's order: the podium, the board, your own row): the Duel's Elo
 * ladder, the arcade's nickname boards and the Bets board. Mitoshi ranked wallets by P&L; Kakure's trades are private,
 * so the Bets board counts only calls their owners chose to publish, as right calls over calls, and every name here is
 * an opt-in nickname linking to its profile.
 */
export function LeaderboardScreen() {
  return (
    <div className="mx-auto flex w-full max-w-(--layout-reading-max) flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Leaderboard</h1>
        <p className="text-body text-muted-foreground">
          The Duel's Elo ladder, the arcade's server-checked runs and published calls, by nickname. No address, no IP,
          no time of day.
        </p>
      </header>
      <BoardsView />
      <div className="flex flex-wrap gap-3">
        <Link href="/games" className={buttonClass("secondary", "sm")}>
          See the games
        </Link>
        <Link href="/privacy" className={buttonClass("quiet", "sm")}>
          How privacy works
        </Link>
      </div>
    </div>
  );
}
