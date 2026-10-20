import type { Metadata } from "next";
import { RetiredMarket } from "@/features/market/retired-market";

/** `/m#<network>/<market id>`: the pool design's market page; old links land here and are sent to the live Windows. */
export const metadata: Metadata = { title: "Market" };

export default function MarketPage() {
  return <RetiredMarket />;
}
