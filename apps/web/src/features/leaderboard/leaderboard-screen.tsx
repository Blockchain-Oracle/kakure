import { buttonClass, EmptyState } from "@kakure/ui-web";
import { Trophy } from "lucide-react";
import Link from "next/link";

/** The boards that open with the games (plan §0 Leaderboard), named so nobody mistakes the empty state for a bug. */
const BOARDS = ["Duel Elo", "Line Rider", "Candle Hop", "Bets"] as const;

/**
 * The leaderboard's honest empty state: no board exists yet, so none is drawn. When it opens, every name is an
 * opt-in nickname bound to a device key, never an address, and Bets ranks only receipts their owners chose to publish.
 */
export function LeaderboardScreen() {
  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-6">
      <h1 className="font-display text-page-title text-foreground">Leaderboard</h1>
      <EmptyState
        icon={<Trophy />}
        title="Boards open with the games"
        reason={
          <>
            {BOARDS.join(" · ")}. Names are opt-in nicknames, never Zcash addresses, and Bets counts only receipts their
            owners publish after a market pays. Until then there is nothing to rank.
          </>
        }
        action={
          <>
            <Link href="/games" className={buttonClass("secondary", "sm")}>
              See the games
            </Link>
            <Link href="/privacy" className={buttonClass("quiet", "sm")}>
              How privacy works
            </Link>
          </>
        }
      />
    </div>
  );
}
