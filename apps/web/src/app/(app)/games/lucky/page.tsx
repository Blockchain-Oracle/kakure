import type { Metadata } from "next";
import { LuckyStage } from "@/features/games/lucky/lucky-stage";

/** `/games/lucky`: reels draw a live Window, a side and a reach on this device; one real trade if you place it (R5). */
export const metadata: Metadata = { title: "Lucky" };

export default function LuckyPage() {
  return <LuckyStage />;
}
