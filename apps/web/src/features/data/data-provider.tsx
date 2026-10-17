"use client";

import { configurePrices, pauseWhenHidden } from "@kakure/feeds";
import { SCHEMA_VERSION } from "@kakure/query";
import { installAudioUnlock } from "@kakure/sounds";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { CACHE_MAX_AGE_MS, PRICE_RELAY, STORAGE_KEYS } from "@/constants";
import { getPrefs } from "@/features/settings/prefs-store";
import { safeStorage } from "@/lib/storage";
import { registerServiceWorker } from "./service-worker";

/**
 * One query cache for the app. Only public, signed data is ever queried, and each query is persisted on its own
 * under `kakure.cache.v1-<query hash>`; every hash starts with the network, so mainnet and testnet caches stay
 * separate and can be cleared separately (plan §13.16). A revisit paints from the device, then re-checks.
 */
function makeClient() {
  const persister = experimental_createQueryPersister({
    storage: typeof window === "undefined" ? undefined : safeStorage,
    prefix: STORAGE_KEYS.cache,
    maxAge: CACHE_MAX_AGE_MS,
    buster: String(SCHEMA_VERSION),
  });
  return new QueryClient({
    defaultOptions: {
      queries: {
        persister: persister.persisterFn,
        gcTime: CACHE_MAX_AGE_MS,
        refetchOnWindowFocus: true,
      },
    },
  });
}

/**
 * The one relay connection for this tab, configured before anything renders so `usePrice` finds it.
 * It opens when a price is shown and closes while the tab is hidden (plan §2 Realtime).
 */
const prices = typeof window === "undefined" ? null : configurePrices(PRICE_RELAY);

export function DataProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);

  useEffect(() => (prices ? pauseWhenHidden(prices) : undefined), []);
  // Preferences apply sound volume and motion; the first tap unlocks audio; the worker caches for offline.
  useEffect(() => {
    getPrefs();
    registerServiceWorker();
    return installAudioUnlock();
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
