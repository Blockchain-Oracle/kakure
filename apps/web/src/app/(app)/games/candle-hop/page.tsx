import type { Metadata } from "next";
import { ArcadeStage } from "@/features/games/arcade/arcade-stage";

/** `/games/candle-hop`: fly the real candles (a signed prints tape), scored by the arcade service's replay (plan §0 R4). */
export const metadata: Metadata = { title: "Candle Hop" };

export default function CandleHopPage() {
  return <ArcadeStage game="candle-hop" />;
}
