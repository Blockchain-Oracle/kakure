import "./relay-socket";
import { configurePrices } from "@kakure/feeds";
import { SCHEMA_VERSION } from "@kakure/query";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addNetworkStateListener } from "expo-network";
import Storage from "expo-sqlite/kv-store";
import { type ReactNode, useEffect, useState } from "react";
import { AppState } from "react-native";
import { CACHE_MAX_AGE_MS, PRICE_RELAY, STORAGE_KEYS } from "@/constants";

/**
 * One query cache for the app. Only public, signed data is ever queried (R11), and each query is persisted on its
 * own under `kakure.cache.v1-<query hash>`; every hash starts with the network, so mainnet and testnet caches stay
 * apart (plan §13.16). A relaunch paints from the device, then re-checks (R7).
 */
function makeClient() {
  const persister = experimental_createQueryPersister({
    storage: Storage,
    prefix: STORAGE_KEYS.cache,
    maxAge: CACHE_MAX_AGE_MS,
    buster: String(SCHEMA_VERSION),
  });
  return new QueryClient({
    defaultOptions: {
      queries: { persister: persister.persisterFn, gcTime: CACHE_MAX_AGE_MS },
    },
  });
}

/** The one relay connection for the app (plan §2 Realtime): open in the foreground, closed in the background. */
export const prices = configurePrices(PRICE_RELAY);

export function DataProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);

  useEffect(() => {
    // TanStack Query on React Native: focus = the app is active; online = the network says so.
    // An alert or the control centre makes the app "inactive" for a moment; only the background closes the relay.
    const appState = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
      if (state === "active") prices.start();
      else if (state === "background") prices.stop();
    });
    onlineManager.setEventListener((setOnline) => {
      const subscription = addNetworkStateListener((state) => setOnline(state.isConnected !== false));
      return () => subscription.remove();
    });
    prices.start();
    return () => {
      appState.remove();
      prices.stop();
    };
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
