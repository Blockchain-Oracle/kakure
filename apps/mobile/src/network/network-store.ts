import { NETWORKS, type Network } from "@kakure/domain";
import { native } from "@kakure/tokens/native";
import { STORAGE_KEYS } from "@/constants";
import { readText, writeText } from "@/lib/kv";
import { createStore, useStore } from "@/lib/store";

/**
 * The active network (C11). Fresh installs start on testnet (tokens' defaultNetwork). Every query key, wallet,
 * ticket and draft is scoped by it (plan §13.16), so a switch never mixes the two.
 */
function initial(): Network {
  const stored = readText(STORAGE_KEYS.network);
  return (NETWORKS as readonly string[]).includes(stored ?? "") ? (stored as Network) : native.defaultNetwork;
}

export const networkStore = createStore<Network>(initial(), (value) => writeText(STORAGE_KEYS.network, value));

export const useNetwork = () => useStore(networkStore);
export const activeNetwork = () => networkStore.get();
