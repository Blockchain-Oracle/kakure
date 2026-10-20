"use client";

import { buttonClass, EmptyState } from "@kakure/ui-web";
import { History } from "lucide-react";
import Link from "next/link";
import { ARCADE } from "../arcade/copy";
import { GAMES } from "../copy";
import { useDuelHistory } from "../duel/use-duel";
import { clearRuns, dayLabel, useKeptRuns, useNickname } from "../player/player-store";

const H = GAMES.history;

/**
 * `/games/history` (Mitoshi `history/GamesHistory.tsx`): your server-checked runs, newest first, with where each ranked
 * when it posted. Mitoshi read them back from its store by wallet; here they're kept on this device as the service
 * accepted them, so the list needs no account and asks the service nothing.
 */
/** Your duels, from the service's record for this device's key (nicknames and days only). */
function Duels() {
  const nickname = useNickname();
  const history = useDuelHistory(nickname !== null);
  const rows = history.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-label={H.duels}>
      <h2 className="font-display text-sheet-heading text-foreground">{H.duels}</h2>
      <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-group border border-border bg-card">
        {rows.map((row) => (
          <li key={row.matchId} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-row-strong text-foreground">{H.vs(row.opponent)}</span>
              <span className="truncate text-meta text-muted-foreground">{dayLabel(row.day)}</span>
            </span>
            <span className="flex flex-col items-end">
              <span className="text-body-strong text-foreground">{H.duelResult[row.result]}</span>
              {row.delta !== null ? (
                <span className="numbers text-meta text-muted-foreground">{H.delta(row.delta)}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function GamesHistory() {
  const runs = useKeptRuns();
  return (
    <div className="gm-page mx-auto flex w-full max-w-(--layout-reading-max) flex-col gap-4">
      <Duels />
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sheet-heading text-foreground">{H.runs}</h2>
        <span className="text-meta text-muted-foreground">{H.scope}</span>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={H.empty.why}
          reason={H.empty.detail}
          action={
            <>
              <Link href="/games/line-rider" className={buttonClass("secondary", "sm")}>
                {GAMES.rank.play(ARCADE.games["line-rider"].title)}
              </Link>
              <Link href="/games/rank" className={buttonClass("quiet", "sm")}>
                {GAMES.rank.title}
              </Link>
            </>
          }
        />
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-group border border-border bg-card">
            {runs.map((run, i) => (
              <li
                // Runs are kept newest first and never reorder; the index is part of their identity.
                key={`${run.game}-${run.day}-${run.score}-${i}`}
                className="flex min-h-14 items-center gap-3 px-4 py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-row-strong text-foreground">{ARCADE.games[run.game].title}</span>
                  <span className="truncate text-meta text-muted-foreground">
                    {[dayLabel(run.day), run.calm ? H.calm : null, run.best ? H.best : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="numbers text-body-strong text-foreground">{ARCADE.fmt(run.score)}</span>
                  <span className="numbers text-meta text-muted-foreground">{H.rank(run.rank)}</span>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className={`${buttonClass("quiet", "sm")} self-start`} onClick={clearRuns}>
            {H.clear}
          </button>
        </>
      )}
    </div>
  );
}
