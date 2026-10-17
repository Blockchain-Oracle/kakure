/**
 * Every tunable in Kakure lives here (rule R8: no magic numbers elsewhere).
 * The Rust operator mirrors these values; shared fixtures in `../fixtures` keep both sides honest.
 */

export const NETWORKS = ["mainnet", "testnet"] as const;
export type Network = (typeof NETWORKS)[number];

/** One-letter network codes keep the bet memo short (memo ≤ 511 bytes, Zingo's limit). */
export const NETWORK_MEMO_CODE: Readonly<Record<Network, string>> = { mainnet: "m", testnet: "t" };
/** Byte used for the network inside the ticket hash preimage. */
export const NETWORK_HASH_BYTE: Readonly<Record<Network, number>> = { mainnet: 0x01, testnet: 0x02 };

export const ZATOSHI_PER_ZEC = 100_000_000n;
export const ZEC_DECIMALS = 8;

/** Fixed ticket sizes in zatoshi: ZIP 318 canonical values n × 10^k, n ∈ {1, 2, 5} (decision D9/PD4). */
export const TICKET_SIZES_ZAT: readonly bigint[] = [
  1_000_000n, // 0.01 ZEC
  2_000_000n, // 0.02
  5_000_000n, // 0.05
  10_000_000n, // 0.1
  20_000_000n, // 0.2
  50_000_000n, // 0.5
  100_000_000n, // 1
];

/** Canonical note multipliers used to split payouts so each note looks like ZIP 318 migration traffic. */
export const CANONICAL_MULTIPLIERS: readonly bigint[] = [5n, 2n, 1n];

/** Fee: 2 % of the losing side only (PD5), in basis points. */
export const FEE_BPS = 200n;
export const BPS_DENOMINATOR = 10_000n;

/** Payouts are rounded to the nearest 0.001 ZEC; the house float absorbs the difference both ways (plan §13.1). */
export const PAYOUT_GRID_ZAT = 100_000n;

/** Wrong amounts at or above this are refunded; smaller ones are kept as dust (plan §13.3). */
export const REFUND_MIN_ZAT = 100_000n;

/** Odds stay sealed until each side has this many tickets; the same count is needed to settle (D3, PD20). */
export const MIN_TICKETS_PER_SIDE = 3;
/** After unsealing, totals change only once this many new tickets have arrived (PD15). */
export const MIN_NEW_TICKETS_PER_RELEASE = 3;

/** A signed bundle is published on this clock whether or not anything changed (PD14/PD15). */
export const BATCH_INTERVAL_MS = 10 * 60_000;
/** Betting closes this long before the close (PD3). */
export const CUTOFF_BEFORE_CLOSE_MS = 10 * 60_000;
/** Confirmations on the cutoff block before the qualifying range is frozen (plan §13.4). */
export const FINALITY_CONFIRMATIONS = 10;
/** The UI shows "Closing" this many blocks before the cutoff. */
export const CLOSING_WARNING_BLOCKS = 3;

/** Each payout note is sent at a random time inside this window after resolution (PD16). */
export const PAYOUT_WINDOW_MIN_MS = 2 * 60 * 60_000;
export const PAYOUT_WINDOW_MAX_MS = 6 * 60 * 60_000;

/** Size of each published market-address list; used addresses are dropped each batch (plan §13.14). */
export const ADDRESS_LIST_SIZE = 4096;

/** Bet memo (plain text only; Zodl iOS drops non-text memos, Zingo caps at 511 bytes). */
export const MEMO_PREFIX = "kakure:v1";
export const MEMO_MAX_BYTES = 511;
export const MEMO_FIELD_SEPARATOR = ";";
export const MEMO_KEY_SEPARATOR = "=";
/** Fields after the prefix, in this exact order. The payout address is last (plan §3). */
export const MEMO_FIELDS = ["n", "m", "s", "z", "k", "p"] as const;

/** Random per-ticket nonce: 16 bytes, base64url without padding (22 characters). */
export const NONCE_BYTES = 16;
export const NONCE_B64URL_LENGTH = 22;

/** BLAKE2b-256 with a 16-byte personalisation for ticket hashes (plan §3). */
export const TICKET_HASH_PERSONAL = "Kakure_Ticket_v1";
export const TICKET_HASH_BYTES = 32;
/** Market ids are short ASCII so they fit the memo and the one-byte length prefix in the hash. */
export const MARKET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,47}$/;

/** Sides: close markets are Up/Down, event markets Yes/No. */
export const CLOSE_SIDES = ["U", "D"] as const;
export const EVENT_SIDES = ["Y", "N"] as const;
export type Side = (typeof CLOSE_SIDES)[number] | (typeof EVENT_SIDES)[number];

/** Unified Address receiver typecodes (ZIP 316). Payout addresses must contain Orchard (PD18). */
export const UA_TYPECODE_P2PKH = 0x00;
export const UA_TYPECODE_P2SH = 0x01;
export const UA_TYPECODE_SAPLING = 0x02;
export const UA_TYPECODE_ORCHARD = 0x03;

/** ZIP 321 payment URIs. */
export const ZIP321_SCHEME = "zcash:";
