import type { Metadata } from "next";
import { ArcadeStage } from "@/features/games/arcade/arcade-stage";

/** `/games/line-rider`: sled the real chart (a signed prints tape), scored by the arcade service's replay (plan §0 R4). */
export const metadata: Metadata = { title: "Line Rider" };

export default function LineRiderPage() {
  return <ArcadeStage game="line-rider" />;
}
