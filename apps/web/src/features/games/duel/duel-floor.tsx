"use client";

import Link from "next/link";
import { Marble } from "../kit/marble";
import { dayLabel } from "../player/player-store";
import { DUEL } from "./copy";
import { useDuelRecent } from "./use-duel";
import "./duel-floor.css";

const PAIR_PX = 24;

/**
 * Duel before a game (Mitoshi `duel/DuelFloor.tsx`): who waits now and the last decided duels, by nickname and day,
 * from the service's own record. Real reads only; an empty floor says so.
 */
export function DuelFloor({ waiting, rating }: { waiting: number | null; rating: number | null }) {
  const recent = useDuelRecent();
  const F = DUEL.floor;
  return (
    <section className="du-floor" aria-label={F.label}>
      <div>
        <h2 className="du-floor-title">{F.waitingNow}</h2>
        <p className="du-floor-count">
          {waiting === null ? "…" : F.waiting(waiting)}
          {rating !== null ? ` · ${F.yourRating(rating)}` : ""}
        </p>
      </div>
      <div>
        <h2 className="du-floor-title">{F.lastDuels}</h2>
        {recent.data && recent.data.length > 0 ? (
          <ul className="du-feed">
            {recent.data.map((d, i) => (
              // Duels are listed newest first and never reorder.
              <li key={`${d.a}-${d.b}-${d.day}-${i}`} className="du-feed-row">
                <span className="du-feed-pair" aria-hidden>
                  <Marble seed={d.a} size={PAIR_PX} />
                  <Marble seed={d.b} size={PAIR_PX} />
                </span>
                <span className="du-feed-main">
                  <span className="du-feed-title">{F.vs(d.a, d.b)}</span>
                  <span className="du-feed-sub">{d.winner ? F.wonBy(d.winner) : F.draw}</span>
                </span>
                <span className="du-feed-time">{dayLabel(d.day)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="du-note">{recent.isError ? DUEL.offline : F.empty}</p>
        )}
        <Link href="/games/rank" className="du-floor-link">
          {F.ladder}
        </Link>
      </div>
    </section>
  );
}
