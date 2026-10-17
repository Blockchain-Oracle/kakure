import type { Network } from "@kakure/domain";
import { type MarketData, useMarketData } from "@kakure/query";
import { DATA_SOURCE } from "@/constants";
import { useNetwork } from "@/network/network-store";

/**
 * The uniform load every visitor makes (PD14): latest → bundle → address list for the active network, verified
 * against the pinned operator key. Screens read markets from the bundle; market ids never reach the host.
 */
export function useMarkets(network?: Network): MarketData & { network: Network } {
  const active = useNetwork();
  const chosen = network ?? active;
  return { ...useMarketData(DATA_SOURCE, chosen), network: chosen };
}
