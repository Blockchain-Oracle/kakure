"use client";

import { NICKNAME_PATTERN, type Profile } from "@kakure/arcade";
import { buttonClass, EmptyState, Skeleton } from "@kakure/ui-web";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useFragment } from "@/features/market/fragment";
import { ARCADE } from "../arcade/copy";
import { BETS } from "../bets/copy";
import { useProfile } from "../bets/queries";
import { BADGE_TILTS } from "../constants";
import { Marble } from "../kit/marble";
import { Sticker } from "../kit/sticker";
import "../kit/kit.css";

const P = BETS.profile;
const AVATAR_PX = 72;

function Figure({ title, line }: { title: string; line: string | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-group border border-border bg-card p-4">
      <span className="text-label-micro uppercase tracking-wider text-muted-foreground">{title}</span>
      <span className="numbers text-body-strong text-foreground">{line ?? P.none}</span>
    </div>
  );
}

function Figures({ profile }: { profile: Profile }) {
  const games = (["line-rider", "candle-hop"] as const).map((game) => {
    const score = profile.arcade[game];
    return { game, line: score ? `${ARCADE.fmt(score.best)} · #${score.rank}` : null };
  });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Figure
        title={P.duel}
        line={profile.duel ? P.duelLine(profile.duel.rating, profile.duel.won, profile.duel.finished) : null}
      />
      <Figure title={P.bets} line={profile.bets ? P.betsLine(profile.bets.right, profile.bets.calls) : null} />
      {games.map(({ game, line }) => (
        <Figure key={game} title={ARCADE.games[game].title} line={line} />
      ))}
    </div>
  );
}

/**
 * `/u#<nickname>` (plan §0 R7): a nickname's public play: the Duel's rating and record, its arcade bests and ranks, its
 * Bets record from five published calls, and the badges those earn. The name lives in the fragment, so the site's host
 * serves the same page for every profile, and the arcade gets it in a request body.
 */
export function ProfileScreen() {
  const fragment = useFragment();
  const raw = fragment === null ? null : decodeURIComponent(fragment.replace(/^#/, ""));
  const nickname = raw !== null && NICKNAME_PATTERN.test(raw) ? raw : null;
  const profile = useProfile(nickname);
  const missing = fragment !== null && (nickname === null || profile.isError);
  return (
    <div className="mx-auto flex w-full max-w-(--layout-reading-max) flex-col gap-6">
      {missing ? (
        <EmptyState
          icon={<UserRound />}
          title={P.missing}
          reason={P.missingDetail}
          action={
            <Link href="/leaderboard" className={buttonClass("secondary", "sm")}>
              Leaderboard
            </Link>
          }
        />
      ) : !profile.data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="size-18 rounded-full" />
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="h-40 w-full rounded-group" />
        </div>
      ) : (
        <>
          <header className="flex items-center gap-4">
            <Marble seed={profile.data.nickname} size={AVATAR_PX} />
            <span className="flex min-w-0 flex-col">
              <span className="text-label-micro uppercase tracking-wider text-muted-foreground">{P.title}</span>
              <h1 className="truncate font-display text-page-title text-foreground">{profile.data.nickname}</h1>
            </span>
          </header>
          <Figures profile={profile.data} />
          <section aria-label={P.badges} className="flex flex-col gap-3">
            <h2 className="text-label-micro uppercase tracking-wider text-muted-foreground">{P.badges}</h2>
            {profile.data.badges.length === 0 ? (
              <p className="text-meta text-muted-foreground">{P.noBadges}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {profile.data.badges.map((badge, i) => (
                  <Sticker
                    key={badge}
                    tone={i % 2 === 0 ? "accent" : "up"}
                    tilt={BADGE_TILTS[i % BADGE_TILTS.length] ?? 0}
                  >
                    {BETS.badge[badge] ?? badge}
                  </Sticker>
                ))}
              </div>
            )}
          </section>
          <p className="text-meta text-muted-foreground">{P.foot}</p>
        </>
      )}
    </div>
  );
}
