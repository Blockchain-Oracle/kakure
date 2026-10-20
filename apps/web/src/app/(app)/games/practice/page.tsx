import type { Metadata } from "next";
import { PracticeStage } from "@/features/games/practice/practice-stage";

/** `/games/practice`: Beat the coin, five live Windows scored on the live price, free (plan §0 R4). */
export const metadata: Metadata = { title: "Beat the coin" };

export default function PracticePage() {
  return <PracticeStage />;
}
