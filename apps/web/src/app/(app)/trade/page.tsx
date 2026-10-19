import type { Metadata } from "next";
import { TradeScreen } from "@/features/trade/trade-screen";

/** `/trade#BTC`: the rail's first place, the dock's seal and key 1; the live terminal for one asset's window. */
export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return <TradeScreen />;
}
