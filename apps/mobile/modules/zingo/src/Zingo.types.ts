/** Chain hints the binding accepts (`IndexerConnection.chain_hint`). */
export type ChainHint = "main" | "test";

export type Network = "mainnet" | "testnet";

export interface WalletStatus {
  status: "created" | "opened" | "restored" | "absent";
  chain: ChainHint;
  /** Wallet birthday height. Absent when no wallet exists. */
  birthday?: number | null;
}

export interface WalletAddress {
  /** Unified address; Orchard receiver only. */
  address: string;
  addressIndex: number;
  orchard: boolean;
  sapling: boolean;
  transparent: boolean;
  /** True when this call derived the address. */
  created: boolean;
}

export interface SyncStatus {
  phase: "idle" | "running" | "complete";
  progress: {
    sync_start_height: number;
    total_blocks_scanned: number;
    total_blocks: number;
    percentage_total_blocks_scanned: number;
    percentage_total_outputs_scanned: number;
    [key: string]: unknown;
  };
  /** The binding's session report once the sync task reached the tip. */
  report: Record<string, unknown> | null;
  walletHeight: number | null;
  serverHeight: number | null;
}

/** Per-pool balances in zatoshis; `null` when the wallet cannot tell yet. */
export interface Balance {
  pools: Record<
    `${"confirmed" | "unconfirmed" | "total"}_${"ironwood" | "orchard" | "sapling" | "transparent"}_balance`,
    number | null
  >;
  spendable: { spendable_balance: number };
}

export interface SendResult {
  txids: string[];
  fee: number;
  /** Pools the proposal spends from, e.g. ["ironwood"]. */
  sourcePools: string[];
  destinationPools: string[];
  timings: {
    /** Proxy start + attach + wait for `ready`; 0 when already ready. */
    mixnetMs: number;
    proxyStartMs: number;
    proposeMs: number;
    /** Prove, sign and transmit over the mixnet. */
    confirmMs: number;
    totalMs: number;
  };
}

export interface MixnetStatus {
  mixnet_indicator: "bootstrapping" | "ready" | "off" | "died";
  socks5_addr?: string;
}
