"use client";

import { type MarketData, useMarketData } from "@kakure/query";
import { DATA_SOURCE } from "@/constants";
import { useNetwork } from "@/features/network/network-store";

/** The current network's signed bundle (the same uniform load on every page). */
export function useMarkets(): MarketData & { network: ReturnType<typeof useNetwork> } {
  const network = useNetwork();
  return { ...useMarketData(DATA_SOURCE, network), network };
}
