import { type DataSource, OPERATOR_PUBLIC_KEYS } from "@kakure/query";

/**
 * Web app settings (rule R8: no magic numbers in components). Protocol tunables live in
 * @kakure/domain constants; visual values live in @kakure/tokens.
 */

/**
 * Development only: verify files signed with another key (your own operator run, or a test fixture) without
 * touching the pinned keys. Production builds ignore it (the branch is removed at build time).
 */
const DEV_TESTNET_KEY =
  process.env.NODE_ENV === "development" ? (process.env.NEXT_PUBLIC_DEV_OPERATOR_KEY_TESTNET ?? null) : null;

/** Where the signed public files are served (services/data-worker in production; scripts/dev.mjs locally). */
export const DATA_SOURCE: DataSource = {
  base: process.env.NEXT_PUBLIC_DATA_BASE ?? "/data",
  ...(DEV_TESTNET_KEY ? { keys: { ...OPERATOR_PUBLIC_KEYS, testnet: DEV_TESTNET_KEY } } : {}),
};

/** The price relay (services/price-relay). Every client receives every symbol (PD19). */
export const PRICE_RELAY =
  process.env.NEXT_PUBLIC_PRICE_RELAY ?? "https://kakure-prices.kakure-price-relay.workers.dev";

/** Device storage keys. The cache prefix is followed by the query hash, which starts with the network. */
export const STORAGE_KEYS = {
  network: "kakure.network.v1",
  theme: "kakure.theme.v1",
  cache: "kakure.cache.v1",
} as const;

/** Persisted public data older than this is dropped (it is re-fetched and re-verified anyway). */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** "Closing soon" lists open markets whose betting closes within this window. */
export const CLOSING_SOON_MS = 60 * 60_000;

/** Countdowns tick once a second. */
export const CLOCK_TICK_MS = 1000;

/** Testnet faucets (context/05-node-and-infra/testnet-regtest-faucets.md, both loading on 2026-10-14). */
export const FAUCETS = [
  { name: "Fauzec", href: "https://fauzec.com/" },
  { name: "Valar", href: "https://faucet.testnet.valargroup.dev" },
] as const;

export const NETWORK_LABEL = { mainnet: "Mainnet", testnet: "Testnet" } as const;
export const NETWORK_COIN = { mainnet: "ZEC", testnet: "TAZ" } as const;
