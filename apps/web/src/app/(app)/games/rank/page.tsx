import type { Metadata } from "next";
import { GamesRank } from "@/features/games/rank/games-rank";

/** `/games/rank`: the arcade's nickname boards, today, this week and all time (plan §0 R4). */
export const metadata: Metadata = { title: "Rank" };

export default function RankPage() {
  return <GamesRank />;
}
