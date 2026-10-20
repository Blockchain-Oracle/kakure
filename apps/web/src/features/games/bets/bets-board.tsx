"use client";

import { BETS_PERIODS, type BetsPeriod } from "@kakure/arcade";
import { buttonClass, EmptyState, SegmentedControl } from "@kakure/ui-web";
import { RefreshCw, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ARCADE } from "../arcade/copy";
import { GAMES } from "../copy";
import { Podium } from "../kit/podium";
import { type RankingRow, Rankings } from "../kit/rankings";
import { useNickname } from "../player/player-store";
import { BETS } from "./copy";
import { useBetsBoard } from "./queries";

const B = BETS.board;
const R = GAMES.rank;
const PODIUM = 3;

/**
 * The Bets board (plan §0 R7 under v2; Mitoshi's board shape): right calls over calls for each nickname with five
 * published receipts or more, this week or all time, counted the day after they're published. The figure is the
 * nickname's own record; nothing names a market, side, size or return.
 */
export function BetsBoard({ loading }: { loading: React.ReactNode }) {
  const [period, setPeriod] = useState<BetsPeriod>("all");
  const board = useBetsBoard(period);
  const nickname = useNickname();
  const control = (
    <SegmentedControl
      label={B.periodLabel}
      size="sm"
      value={period}
      onChange={setPeriod}
      options={BETS_PERIODS.map((p) => ({ value: p, label: B.periods[p] ?? p }))}
    />
  );
  if (!board.data) {
    if (!board.isError) return loading;
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
    byline: B.byline(r.right, r.calls),
    figure: B.figure(r.right, r.calls),
  }));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">{control}</div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title={B.empty.why}
          reason={B.empty.detail}
          action={
            <Link href="/trade" className={buttonClass("secondary", "sm")}>
              {B.empty.action}
            </Link>
          }
        />
      ) : (
        <>
          <Podium
            label={B.tab}
            places={rows.slice(0, PODIUM).map((r) => ({ rank: r.rank, name: r.name, figure: r.figure }))}
          />
          {rows.length > PODIUM ? (
            <Rankings rows={rows.slice(PODIUM)} you={null} youName={nickname} label={B.tab} youLabel={R.you} />
          ) : null}
        </>
      )}
      <p className="text-meta text-muted-foreground">{B.foot}</p>
    </div>
  );
}
