import type { Metadata } from "next";
import { DuelStage } from "@/features/games/duel/duel-stage";

/** `/games/duel`: three live Windows, head to head, calls sealed until both lock in; free, Elo-ranked (plan §0 R5). */
export const metadata: Metadata = { title: "Duel" };

export default function DuelPage() {
  return <DuelStage />;
}
