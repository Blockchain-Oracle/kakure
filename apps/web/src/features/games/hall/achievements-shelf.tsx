"use client";

import { GAMES } from "../copy";
import { achievementsOf, useDeviceFacts } from "./device-facts";

/**
 * The achievements shelf (Mitoshi `hall/AchievementsShelf.tsx`, from Owarine's AchievementsPlate): what this device has
 * earned and what the rest take; a locked badge names its goal rather than hiding. Each follows from a record this
 * device keeps (a ranked run, a Practice round, a call held to its close), and none is sent anywhere.
 */
export function AchievementsShelf() {
  const facts = useDeviceFacts();
  const shelf = achievementsOf(facts);
  const earned = shelf.filter((a) => a.earned).length;
  return (
    <section className="ach" aria-label={GAMES.achievements.title}>
      <div className="ach-head">
        <h2 className="ach-title">{GAMES.achievements.title}</h2>
        <span className="ach-count">
          {GAMES.achievements.count(earned, shelf.length)} · {GAMES.achievements.scope}
        </span>
      </div>
      <ul className="ach-list">
        {shelf.map((badge) => (
          <li key={badge.id} className="ach-badge" data-on={badge.earned || undefined}>
            <span className="ach-name">{badge.title}</span>
            <span className="ach-how">{badge.how}</span>
            {badge.need > 1 && !badge.earned ? (
              <span className="ach-progress">
                {badge.have} / {badge.need}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
