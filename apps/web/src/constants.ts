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
  prefs: "kakure.prefs.v1",
  /** The terminal's settings (features/terminal/settings.ts). */
  trade: "kakure.trade.v1",
} as const;

/** Every device-storage key starts with this (Forget this device clears them all). */
export const STORAGE_PREFIX = "kakure.";

/**
 * The device vault (IndexedDB, features/vault/vault-db.ts): tickets, chips, deposits and spends, one key per network
 * (plan §00, §13.16–17). The names are the ticket store's from before the vault, so existing tickets carry over.
 */
export const VAULT_DB = { name: "kakure-tickets", version: 1, keys: "keys", records: "tickets" } as const;

/** Export files: PBKDF2-SHA-256 → AES-GCM-256 (plan §2 Device storage). */
export const EXPORT_KDF_ITERATIONS = 310_000;
export const EXPORT_FILE_EXTENSION = ".kakure";

/** The public site, for the market-link QR the Kakure app scans (plan §1 Web bet). */
export const SITE_ORIGIN = "https://getkakure.xyz";

/** The docs site (apps/docs), served at the root of its own host (plan §13.11). */
export const DOCS_ORIGIN = process.env.NEXT_PUBLIC_DOCS_ORIGIN ?? "https://docs.getkakure.xyz";

/** The public source repository. */
export const REPO_URL = "https://github.com/Blockchain-Oracle/kakure";

/** Android builds: GitHub Releases of the public repo, tags `android-*` (read at build time). */
export const RELEASES = { repo: "Blockchain-Oracle/kakure", tagPrefix: "android-" } as const;

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
