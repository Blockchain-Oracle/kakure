import type { Metadata } from "next";
import { MarketScreen } from "@/features/market/market-screen";

/** `/m#<network>/<market id>`: one static page for every market; the id stays in the fragment (PD14). */
export const metadata: Metadata = { title: "Market" };

export default function MarketPage() {
  return <MarketScreen />;
}
