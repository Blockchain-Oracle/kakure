"use client";

import { ARCADE_GAMES, type ArcadeGame, BOARD_PERIODS, type BoardPeriod, RANK_LIMIT } from "@kakure/arcade";
import { buttonClass, EmptyState, SegmentedControl, Skeleton, Tabs } from "@kakure/ui-web";
import { RefreshCw, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ARCADE } from "../arcade/copy";
import { GAMES } from "../copy";
import { Podium } from "../kit/podium";
import { type RankingRow, Rankings } from "../kit/rankings";
import { dayLabel, useNickname } from "../player/player-store";
import { useBoard, useStanding } from "../player/queries";

const R = GAMES.rank;
const PODIUM = 3;
const BONES = ["a", "b", "c", "d", "e"] as const;

function Bones() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status">
        {R.reading}
      </span>
      <div className="grid grid-cols-3 items-end gap-3">
        {["h-16", "h-24", "h-12"].map((h) => (
          <div key={h} className="flex flex-col items-center gap-2">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className={`${h} w-full rounded-t-md`} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {BONES.map((b) => (
          <Skeleton key={b} className="h-14 w-full rounded-row" />
        ))}
      </div>
    </div>
  );
}

function Board({ game, period }: { game: ArcadeGame; period: BoardPeriod }) {
  const board = useBoard(game, period, RANK_LIMIT);
  const standing = useStanding(game);
  const nickname = useNickname() ?? standing.data?.nickname ?? null;
  if (!board.data) {
    if (!board.isError) return <Bones />;
    return (
      <EmptyState
        icon={<RefreshCw />}
        tone="warn"
        title={R.failed}
        reason={ARCADE.board.unreachable}
        action={
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => void board.refetch()}>
            {R.retry}
          </button>
        }
      />
    );
  }
  const rows: RankingRow[] = board.data.rows.map((r, i) => ({
    rank: i + 1,
    name: r.nickname,
    byline: [R.played(dayLabel(r.day)), r.calm ? R.calm : null].filter(Boolean).join(" · "),
    figure: ARCADE.fmt(r.score),
  }));
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Trophy />}
        title={R.empty.why}
        reason={R.empty.detail}
        action={
          <Link href={`/games/${game}`} className={buttonClass("secondary", "sm")}>
            {R.play(ARCADE.games[game].title)}
          </Link>
        }
      />
    );
  }
  // Your all-time standing joins the all-time board when you rank below it.
  const inList = nickname !== null && rows.some((r) => r.name === nickname);
  const you: RankingRow | null =
    period === "all" && nickname && !inList && standing.data?.best != null && standing.data.rank != null
      ? { rank: standing.data.rank, name: nickname, byline: R.you, figure: ARCADE.fmt(standing.data.best) }
      : null;
  return (
    <div className={`flex flex-col gap-5 transition-opacity ${board.isFetching ? "opacity-80" : ""}`}>
      <Podium
        label={ARCADE.games[game].title}
        places={rows.slice(0, PODIUM).map((r) => ({ rank: r.rank, name: r.name, figure: r.figure }))}
      />
      {rows.length > PODIUM || you ? (
        <Rankings
          rows={rows.slice(PODIUM)}
          you={you}
          youName={nickname}
          label={ARCADE.games[game].title}
          youLabel={R.you}
        />
      ) : null}
    </div>
  );
}

/**
 * The arcade's boards (Mitoshi `rank/GamesRank.tsx`): text tabs over Line Rider and Candle Hop, Today · This week · All
 * time, each on the podium and the ranked list, 50 deep, with your own row. Before its rows a board is one of four
 * states: bones, a failed read with Retry, or an empty board with its game. Names are nicknames only.
 */
export function BoardsView({ initialGame = "line-rider" }: { initialGame?: ArcadeGame }) {
  const [game, setGame] = useState<ArcadeGame>(initialGame);
  const [period, setPeriod] = useState<BoardPeriod>("all");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label={R.title}
          value={game}
          onChange={setGame}
          items={ARCADE_GAMES.map((g) => ({ value: g, label: R.tabs[g] }))}
        />
        <SegmentedControl
          label={R.periodLabel}
          size="sm"
          value={period}
          onChange={setPeriod}
          options={BOARD_PERIODS.map((p) => ({ value: p, label: R.periods[p] }))}
        />
      </div>
      <Board game={game} period={period} />
      <p className="text-meta text-muted-foreground">{R.foot}</p>
    </div>
  );
}
