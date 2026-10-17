"use client";

import { MARKET_ID_PATTERN, NETWORKS, type Network } from "@kakure/domain";
import { useSyncExternalStore } from "react";

/**
 * `/m#<network>/<market id>`: the market lives in the fragment, which browsers never send, so the host sees the
 * same request for every market (PD14, plan §13.11).
 */
export function parseMarketFragment(hash: string): { network: Network; id: string } | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  const [network, id, ...rest] = decoded.split("/");
  if (rest.length > 0 || !network || !id) return null;
  if (!(NETWORKS as readonly string[]).includes(network) || !MARKET_ID_PATTERN.test(id)) return null;
  return { network: network as Network, id };
}

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

/** The current fragment; `null` while prerendering (the fragment only exists in the browser). */
export function useFragment(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => location.hash,
    () => null,
  );
}
