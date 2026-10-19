"use client";

import { type RealtimeData, useRealtimeData } from "@kakure/query";
import { DATA_SOURCE } from "@/constants";
import { useNetwork } from "@/features/network/network-store";

/** The current network's real-time bundle, refreshed every minute (the same uniform load on every page). */
export function useRealtime(): RealtimeData & { network: ReturnType<typeof useNetwork> } {
  const network = useNetwork();
  return { ...useRealtimeData(DATA_SOURCE, network), network };
}
