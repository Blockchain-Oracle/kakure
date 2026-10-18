import type { Network } from "@kakure/domain";
import { type MarketData, useMarketData } from "@kakure/query";
import { DATA_SOURCE } from "@/constants";
import { useNetwork } from "@/network/network-store";

/**
 * Markets for one network (the active one by default), verified against the pinned operator key. The files
 * themselves are loaded for BOTH networks at the root (UniformLoad in DataProvider, audit O8); this reads the same
 * queries from the cache. Market ids never reach the host.
 */
export function useMarkets(network?: Network): MarketData & { network: Network } {
  const active = useNetwork();
  const chosen = network ?? active;
  return { ...useMarketData(DATA_SOURCE, chosen), network: chosen };
}
