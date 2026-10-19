import type { Metadata } from "next";
import { GamesScreen } from "@/features/games/games-screen";

export const metadata: Metadata = { title: "Games" };

export default function GamesPage() {
  return <GamesScreen />;
}
