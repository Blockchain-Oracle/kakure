import type { Metadata } from "next";
import { MoonshotScreen } from "@/features/range/moonshot-screen";

/** `/games/moonshot`: a direction and a reach; the house sets the level the close must finish past (plan §00 T5a). */
export const metadata: Metadata = { title: "Moonshot" };

export default function MoonshotPage() {
  return <MoonshotScreen />;
}
