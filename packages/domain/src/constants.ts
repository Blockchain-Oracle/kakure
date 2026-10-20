/**
 * Every tunable in Kakure lives here (rule R8: no magic numbers elsewhere).
 * The Rust operator mirrors these values; shared fixtures in `../fixtures` keep both sides honest.
 */

export const NETWORKS = ["mainnet", "testnet"] as const;
export type Network = (typeof NETWORKS)[number];

/**
 * The operator's Ed25519 public keys, pinned in the build and never fetched (plan §2, §13.11).
 * Hex, 32 bytes (64 characters), one per network because the operator runs one process per network.
 *
 * Both are pinned. A network whose key is null would show "This build has no operator key": unverified data is
 * never shown.
 */
export const OPERATOR_PUBLIC_KEYS: Readonly<Record<Network, string | null>> = {
  /** The mainnet operator's key (base64url sG_wKO_4xxEWnCqkvVhmLuq-rwHxv7RjPlgqhLKFSzs), pinned 2026-10-17. */
  mainnet: "b06ff028eff8c711169c2aa4bd58662eeabeaf01f1bfb4633e582a84b2854b3b",
  /** The testnet operator's key (base64url AJ556QMDemUB-ZxXMaxeegFccD_0tn8QlMqdjx6rw3s), pinned 2026-10-17. */
  testnet: "009e79e903037a6501f99c5731ac5e7a015c703ff4b67f1094ca9d8f1eabc37b",
};

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
/**
 * A market's published `ticketCount`, `leaves` and totals change only in releases of at least this many new tickets,
 * sealed or not, first release included (PD15, PD28). Tickets still unreleased when the cutoff block is final (fewer
 * than this) are refunded in full and never counted.
 */
export const MIN_NEW_TICKETS_PER_RELEASE = 3;

/** A signed bundle is published on this clock whether or not anything changed (PD14/PD15). */
export const BATCH_INTERVAL_MS = 10 * 60_000;
/** Betting closes this long before the close (PD3). */
export const CUTOFF_BEFORE_CLOSE_MS = 10 * 60_000;
/** Confirmations on the cutoff block before the qualifying range is frozen (plan §13.4). */
export const FINALITY_CONFIRMATIONS = 10;
/** The UI shows "Closing" this many blocks before the cutoff. */
export const CLOSING_WARNING_BLOCKS = 3;

/**
 * Mainnet sends pause this many blocks before a NU7 height the software does not know (plan §3). It exceeds the
 * post-NU7 expiry delta (120), so no pre-NU7 transaction straddles activation. Operator and app use the same margin.
 */
export const NU7_PAUSE_MARGIN_BLOCKS = 150;

/** Size of each published market-address list (plan §13.14). */
export const ADDRESS_LIST_SIZE = 1024;
/**
 * Every batch retires the used addresses plus random unused ones, a multiple of this many in all (never fewer), so a
 * paid address can't be told apart from the decoys retired with it (O9). Retired addresses still receive.
 */
export const ADDRESS_RETIRE_MIN = 8;

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
/** `rulesHash` = BLAKE2b-256 with this 16-byte personalisation over the canonical JSON of the rules object (D13). */
export const RULES_HASH_PERSONAL = "Kakure_Rules_v01";
/**
 * `latest.bundleHash`, `bundle.previous` and the `addresses-<first 8 hex>.json` names: SHA-256 (hex) over the exact
 * bytes of the published file. Every published file is the canonical JSON of its signed document (sig included).
 */
export const BUNDLE_HASH_ALGORITHM = "SHA-256";
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

/* ── Real-time markets (plan §00 REVAMP 2). Mirrored in services/operator/src/lanes.rs and fair.rs. ───────────── */

/** The 24/7 crypto lanes. Stocks join when their price source is live. */
export const LANE_ASSETS = ["BTC", "ETH", "SOL", "ZEC", "XRP", "DOGE"] as const;
export type LaneAsset = (typeof LANE_ASSETS)[number];

/** Window lengths, shortest first: 1m, 2m, 5m, 15m, 1h, 4h, 1d (Owarine's crypto lanes plus 1m). */
export const CADENCES_SEC = [60, 120, 300, 900, 3_600, 14_400, 86_400] as const;

/**
 * Two series half a Window apart on the short lanes, so a Window is always mid-trade (Owarine's staggered phases,
 * `crypto.ts:27`). Phases are whole minutes: every boundary lands on a 1-minute venue candle.
 */
export const PHASES_SEC: Readonly<Record<number, readonly number[]>> = { 120: [0, 60], 300: [0, 180] };

/** Entry and early close stop this long before expiry (Owarine/Mitoshi `ENTRY_BUFFER_SEC`). */
export const ENTRY_BUFFER_SEC = 30;

/** The fair price never uses less time left than this (Agari/Mitoshi `MIN_SECONDS_LEFT`). */
export const MIN_TAU_SEC = 5;

/**
 * σ is realised over the last 5 hours of the first voting venue's committed 1-minute closes (the closes the hourly
 * prints files publish, so anyone can recompute it), annualised over a 365-day year of minutes.
 */
export const SIGMA_WINDOW_MINUTES = 300;
export const SIGMA_MINUTES_PER_YEAR = 525_600;
export const SIGMA_MIN = 0.2;
export const SIGMA_MAX = 2.5;
export const SIGMA_DECIMALS = 4;
/** Fewer 1-minute returns than this and σ isn't re-estimated (the last value stands). */
export const SIGMA_MIN_RETURNS = 60;

/* ── House pricing (plan §00 T3 contract). Mirrored in services/operator/src/fair.rs; fixtures/fair.json keeps them
 * identical. Prices are integers in 1/10,000 ("E4"); pays × = 10,000 / askE4. */

/** σ is annual; time left is measured in a 365-day year of seconds (the 24/7 lanes' clock, Mitoshi `CALENDAR_YEAR_SEC`). */
export const YEAR_SEC = 31_536_000;
/** Abramowitz–Stegun 7.1.26: erf(x) ≈ 1 − t·(a₁ + t·(a₂ + t·(a₃ + t·(a₄ + t·a₅))))·e^(−x²), t = 1 / (1 + p·x). */
export const ERF_P = 0.3275911;
export const ERF_A = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429] as const;
export const HALF = 0.5;
/** Φ⁻¹ by bisection: 60 halvings of [−8, 8] reach machine precision; p is kept 1e-12 inside (0, 1). */
export const INVERSE_Z_BOUND = 8;
export const INVERSE_ITERATIONS = 60;
export const INVERSE_EPSILON = 1e-12;
export const PRICE_SCALE_E4 = 10_000;
/** Half the house's spread around the fair price: 2.5 points. */
export const HALF_SPREAD_E4 = 250;
/** A side can be bought only while its ask is at most this, and closed only while its bid is at least `MIN_BID_E4`. */
export const MAX_ASK_E4 = 9_800;
export const MIN_BID_E4 = 200;
/** Before a Window opens its opening print is unknown to everyone: both sides are worth one half. */
export const PRE_OPEN_PROBABILITY = 0.5;
/** The smallest chip: payouts and close values are floored to it (the house keeps the remainder). */
export const CHIP_GRID_ZAT = 1_000;
/** The chip ladder's steps within each decade (ZIP 318 canonical values n × 10^k, n ∈ {1, 2, 5}). */
export const LADDER_STEPS = [1, 2, 5] as const;
export const LADDER_DECADE = 10;
/** Withdrawals go in steps of 0.001 ZEC: each note is its own transaction. */
export const WITHDRAW_GRID_ZAT = 100_000;
/**
 * A trade's price tolerance (Owarine terminal `settings.ts`): the quote moved by this many basis points, plus a fixed
 * cushion of one point (Owarine `SLIPPAGE_MIN_TICKS`: 10 of 1,000). Short Windows move fast: with three minutes left a
 * 1 bp move in BTC shifts the price about three points.
 */
export const DEFAULT_SLIPPAGE_BPS = 200;
export const SLIPPAGE_CHOICES_BPS = [50, 100, 200, 500] as const;
export const SLIPPAGE_CUSHION_E4 = 100;
export const BPS_SCALE = 10_000;
/** The operator won't quote when its price stream has been silent this long, or the asset's price is this old. */
export const QUOTE_MAX_SILENCE_MS = 3_000;
export const QUOTE_MAX_PRICE_AGE_MS = 30_000;

/** Parlays (Owarine `core/parlay/pricing.ts`): 2–3 legs, prices multiply, all or nothing. Prices in 1/10^8 ("E8"). */
export const PARLAY_MIN_LEGS = 2;
export const PARLAY_MAX_LEGS = 3;
export const PRICE_SCALE_E8 = 100_000_000;
/** Legs that settle at the same instant are correlated: the combined price never drops below half the lowest ask. */
export const PARLAY_CORRELATION_FLOOR_BPS = 5_000;
/** A combined price under 1 % is too long a shot for the house. */
export const PARLAY_MIN_PRICE_E8 = 1_000_000;
/** A leg joins only with this long left before its Window stops trading (operator `trading.rs` PARLAY_LEG_MIN_LEFT_SECS). */
export const PARLAY_LEG_MIN_LEFT_SEC = 30;

/** Venues vote on the close of each 1-minute candle; two of three decide (plan §3, PD20). */
export const VENUE_KEYS = ["coinbase", "kraken", "bitstamp", "gemini"] as const;
export type VenueKey = (typeof VENUE_KEYS)[number];
export const VOTES_TO_DECIDE = 2;
/** Every lane asset is printed by exactly this many venues. */
export const VENUES_PER_ASSET = 3;

/** A real-time bundle every minute; settled Windows stay in it this long, then live on in the hourly prints files. */
export const BUNDLE_INTERVAL_SEC = 60;
export const BUNDLE_SETTLED_KEEP_SEC = 600;
/**
 * An hour's signed prints file is written this long after the hour ends: the 10-minute grace a Window waits for a
 * late venue's closing minute, plus 2 (operator `realtime.rs` PRINTS_DELAY_SECS).
 */
export const PRINTS_DELAY_SEC = 720;
