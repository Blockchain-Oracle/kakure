import type { Metadata } from "next";
import { TradeRedirect } from "@/features/trade/trade-redirect";

/** `/trade`: the rail's first place; the terminal arrives in R2, until then it opens Markets. */
export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return <TradeRedirect />;
}
