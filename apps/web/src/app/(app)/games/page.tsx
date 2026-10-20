import type { Metadata } from "next";
import { GamesHub } from "@/features/games/hall/games-hub";

/** `/games`: the hall, every mode one tap from play (plan §0 R4; Mitoshi's games hub). */
export const metadata: Metadata = { title: "Games" };

export default function GamesPage() {
  return <GamesHub />;
}
