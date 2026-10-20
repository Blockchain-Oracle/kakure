import type { Metadata } from "next";
import { RangeScreen } from "@/features/range/range-screen";

/** `/games/range`: call where a Window closes, inside a band or outside it, priced by the house (plan §00 T5a). */
export const metadata: Metadata = { title: "Range" };

export default function RangePage() {
  return <RangeScreen />;
}
