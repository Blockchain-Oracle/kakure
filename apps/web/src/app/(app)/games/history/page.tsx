import type { Metadata } from "next";
import { GamesHistory } from "@/features/games/history/games-history";

/** `/games/history`: your server-checked runs, kept on this device (plan §0 R4). */
export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return <GamesHistory />;
}
