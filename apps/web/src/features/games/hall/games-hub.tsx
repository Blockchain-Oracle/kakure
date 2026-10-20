"use client";

import { useRealtime } from "@/features/data/use-realtime";
import { useNow } from "@/lib/time";
import { GAMES } from "../copy";
import { MatchTile } from "../duel/match-tile";
import { SettingsButton } from "../games-rail";
import { AchievementsShelf } from "./achievements-shelf";
import { CabinetRail } from "./cabinet-rail";
import { FeaturedCabinet } from "./featured-cabinet";
import { NowPlaying } from "./now-playing";
import { StreakStrip } from "./streak-strip";
import "./hall.css";
import "./shelf.css";

/**
 * `/games`, the hall (Mitoshi `GamesHub.tsx`, the games spec's "Gēsen" direction after Senryo): every machine shows
 * real activity and is one tap from play. One head row (the title, the marquee, settings), the featured cabinet with
 * its PLAY on the first phone screen, the cabinet rail, the streak strip and the achievements. Each cabinet's sticker
 * says whose money is at risk; the rules sit behind each stage's ⓘ.
 */
export function GamesHub() {
  const data = useRealtime();
  const nowMs = useNow();
  const bundle = data.status === "ready" ? data.bundle : null;
  return (
    <div className="gm-page hall">
      <header className="hall-head">
        <h1 className="hall-title">{GAMES.title}</h1>
        <NowPlaying bundle={bundle} nowMs={nowMs} />
        <SettingsButton />
      </header>
      <MatchTile />
      <FeaturedCabinet bundle={bundle} status={data.status} nowMs={nowMs} />
      <CabinetRail bundle={bundle} nowMs={nowMs} />
      <StreakStrip />
      <AchievementsShelf />
    </div>
  );
}
