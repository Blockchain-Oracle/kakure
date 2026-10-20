"use client";

import type { Board } from "@kakure/arcade";
import Link from "next/link";
import { type RankingRow, Rankings } from "../kit/rankings";
import { dayLabel } from "../player/player-store";
import { ARCADE } from "./copy";

/**
 * The cabinet's board (Mitoshi `arcade/ArcadeBoard.tsx`): the replayed runs' top ten by nickname, your own row under
 * them when you rank below, and the line that never falls off: what a score here is.
 */
export function ArcadeBoard({
  board,
  failed,
  nickname,
  standing,
}: {
  board: Board | undefined;
  failed: boolean;
  nickname: string | null;
  standing: { best: number | null; rank: number | null } | undefined;
}) {
  const rows: RankingRow[] = (board?.rows ?? []).map((r, i) => ({
    rank: i + 1,
    name: r.nickname,
    byline: [dayLabel(r.day), r.calm ? ARCADE.board.calm : null].filter(Boolean).join(" · "),
    figure: ARCADE.fmt(r.score),
  }));
  const inTop = nickname !== null && rows.some((r) => r.name === nickname);
  const you: RankingRow | null =
    nickname && !inTop && standing?.best != null && standing.rank != null
      ? { rank: standing.rank, name: nickname, byline: ARCADE.board.you, figure: ARCADE.fmt(standing.best) }
      : null;

  return (
    <section className="ar-board" aria-label={ARCADE.board.title}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="ar-board-title">{ARCADE.board.title}</span>
        <Link href="/games/rank" className="text-meta text-muted-foreground underline-offset-4 hover:underline">
          {ARCADE.board.more}
        </Link>
      </div>
      {failed ? (
        <p className="ar-board-empty">{ARCADE.board.unreachable}</p>
      ) : board === undefined ? (
        <p className="ar-board-empty">{ARCADE.board.loading}</p>
      ) : rows.length === 0 ? (
        <p className="ar-board-empty">{ARCADE.board.empty}</p>
      ) : (
        <Rankings rows={rows} you={you} youName={nickname} label={ARCADE.board.title} youLabel={ARCADE.board.you} />
      )}
      <p className="ar-board-foot">{ARCADE.honesty}</p>
    </section>
  );
}
