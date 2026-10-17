/** S00 smoke settings. Replaced by packages/domain constants in S06. */
export const SMOKE_NETWORK = "testnet" as const;
export const TESTNET_SERVER = "https://testnet.zec.rocks:443";
export const SYNC_POLL_MS = 2000;
export const ZATOSHIS_PER_ZEC = 100_000_000;
export const ZEC_DECIMALS = 8;
export const SMOKE_SEND_ZATOSHIS = "100000";
export const SMOKE_MEMO = "kakure:v1;app-smoke";
export const SPENDABLE_RETRY_MS = 60_000;
export const SPENDABLE_MAX_TRIES = 20;
/** Bounds one sync wait: 150 polls at SYNC_POLL_MS = 5 min. */
export const SYNC_MAX_POLLS = 150;
