"use client";

import { buttonClass } from "@kakure/ui-web";
import Link from "next/link";
import { BoardsView } from "@/features/games/rank/boards-view";

/** The boards that open later (plan §0 Leaderboard), named so nobody mistakes their absence for a bug. */
const LATER = [
  { name: "Duel Elo", when: "opens with Duel" },
  { name: "Bets", when: "opens with published receipts" },
] as const;

/**
 * `/leaderboard` (Mitoshi's LeaderboardScreen, Masayume's order: the podium, the board, your own row): the arcade's
 * nickname boards, today, this week and all time. Mitoshi ranked wallets by P&L; Kakure's trades are private, so the
 * trading board waits for receipts their owners choose to publish, and every name here is an opt-in nickname.
 */
export function LeaderboardScreen() {
  return (
    <div className="mx-auto flex w-full max-w-(--layout-reading-max) flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Leaderboard</h1>
        <p className="text-body text-muted-foreground">
          Server-checked arcade runs, by nickname. No address, no IP, no time of day.
        </p>
      </header>
      <BoardsView />
      <section aria-label="Boards opening later" className="flex flex-wrap gap-2">
        {LATER.map((board) => (
          <span key={board.name} className="rounded-full bg-secondary px-3 py-1.5 text-meta text-muted-foreground">
            <span className="text-foreground">{board.name}</span> · {board.when}
          </span>
        ))}
      </section>
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
