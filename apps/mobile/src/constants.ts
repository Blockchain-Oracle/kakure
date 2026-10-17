import type { Network } from "@kakure/domain";
import { type DataSource, OPERATOR_PUBLIC_KEYS } from "@kakure/query";

/**
 * App settings (rule R8: no magic numbers in components). Protocol tunables live in @kakure/domain constants,
 * visual values in @kakure/tokens.
 */

/**
 * Where the signed public files are served (services/data-worker in production). `EXPO_PUBLIC_DATA_BASE` points a
 * development build at `scripts/data-server.mjs`, which serves the local operator's real signed files.
 */
export const DATA_SOURCE: DataSource = {
  base: process.env.EXPO_PUBLIC_DATA_BASE ?? "https://getkakure.xyz/data",
  keys: OPERATOR_PUBLIC_KEYS,
};

/** The price relay (services/price-relay). Every client receives every symbol (PD19). */
export const PRICE_RELAY =
  process.env.EXPO_PUBLIC_PRICE_RELAY ?? "https://kakure-prices.kakure-price-relay.workers.dev";

/** Light-wallet servers the in-app wallet syncs from (zcash-stack-and-feeds §4). */
export const WALLET_SERVER: Readonly<Record<Network, string>> = {
  mainnet: "https://zec.rocks:443",
  testnet: "https://testnet.zec.rocks:443",
};

/** The public site: market links (`/m#<network>/<id>`) and receipt verify links (`/verify#<receipt>`). */
export const SITE_ORIGIN = "https://getkakure.xyz";
export const SITE_HOST = "getkakure.xyz";

export const NETWORK_LABEL: Readonly<Record<Network, string>> = { mainnet: "Mainnet", testnet: "Testnet" };
export const NETWORK_COIN: Readonly<Record<Network, string>> = { mainnet: "ZEC", testnet: "TAZ" };

/** Testnet faucets (context/05-node-and-infra/testnet-regtest-faucets.md). */
export const FAUCETS = [
  { name: "Fauzec", href: "https://fauzec.com/" },
  { name: "Valar", href: "https://faucet.testnet.valargroup.dev" },
] as const;

/** Zodl can migrate restored Orchard funds when this build can't. */
export const ZODL_URL = "https://zodl.com";

/** Pools a bet may spend: Ironwood only, so a bet never crosses pools (D6, plan §1). */
export const BET_POOLS = ["ironwood"] as const;

/**
 * ZIP 317 fee for a two-action Ironwood send (one spend, payment + change). The proposal states the real fee;
 * this reserve only decides whether "Bet" can be offered before proposing.
 */
export const FEE_RESERVE_ZAT = 15_000n;

/** The wallet syncs on launch, on return to the foreground, and on this clock while the app is open. */
export const WALLET_SYNC_EVERY_MS = 60_000;
/** Sync progress is read this often while a sync runs. */
export const SYNC_POLL_MS = 2_000;
/** A sync wait never runs longer than this (150 polls). */
export const SYNC_MAX_POLLS = 150;

/** Countdowns tick once a second. */
export const CLOCK_TICK_MS = 1_000;
/** "Closing soon" lists open markets whose betting closes within this window. */
export const CLOSING_SOON_MS = 60 * 60_000;
/** A local notification is scheduled this long before a market with one of your tickets closes. */
export const CLOSE_REMINDER_MS = 10 * 60_000;

/** Persisted public data older than this is dropped (it is re-fetched and re-verified anyway). */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Export files: PBKDF2-SHA-256 → AES-GCM-256, the same format as the web app (plan §2 Device storage). */
export const EXPORT_KDF_ITERATIONS = 310_000;
export const EXPORT_FILE_EXTENSION = ".kakure";
export const EXPORT_MIN_PASSPHRASE = 8;

/** Device storage keys (secure-store and the kv store). Forget this device clears every one. */
export const STORAGE_KEYS = {
  ticketKey: "kakure.tickets.key.v1",
  prefs: "kakure.prefs.v1",
  network: "kakure.network.v1",
  onboarded: "kakure.onboarded.v1",
  cache: "kakure.cache.v1",
} as const;

/** The encrypted ticket database (SQLCipher). One file, every row tagged with its network (plan §13.16). */
export const TICKET_DB_NAME = "kakure-tickets.db";

/** The seed quiz asks for this many words, at random positions. */
export const QUIZ_WORDS = 3;

/** The backup screen and the bet QR block screenshots; this is the reminder shown when one is attempted. */
export const SCREENSHOT_NOTE = "Screenshots are blocked here. Your words and codes stay on this phone.";

/** Ticket statuses the wallet reports while a bet is on its way (before the bundle counts it). */
export const TX_STEP_LABELS = [
  "Preparing private route",
  "Proving",
  "Sending privately",
  "In mempool",
  "Counted",
] as const;

/** Haptic + sound: how long the slide must be held past its commit point. */
export const SLIDE_COMMIT_FRACTION = 0.9;

/** Replay and Recap need archived one-minute prices (plan §13.15); until they exist the state says so. */
export const PRICE_HISTORY_AVAILABLE = false;

/** A recovery phrase has 12 to 24 words. */
export const MIN_SEED_WORDS = 12;

/** Native sheet heights (kawase.md §4.5 detents 0.62 / 0.88 / 1, plus a near-full sheet for forms). */
export const SHEET_DETENTS = { medium: 0.62, tall: 0.88, form: 0.95, full: 1 } as const;

/** Short forms of hashes on screen: a folio and the leading/trailing characters. */
export const HASH_SHORT = { head: 10, tail: 6, folioStart: 2, folioEnd: 8, file: 8, line: 12 } as const;

export const MS_PER_SECOND = 1000;

/** The 12-word quiz offers this many choices per word. */
export const QUIZ_CHOICES = 4;
