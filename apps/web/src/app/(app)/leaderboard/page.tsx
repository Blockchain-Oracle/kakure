import type { Metadata } from "next";
import { LeaderboardScreen } from "@/features/leaderboard/leaderboard-screen";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return <LeaderboardScreen />;
}
