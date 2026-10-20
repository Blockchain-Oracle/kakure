"use client";

import type { Network } from "@kakure/domain";
import type { PendingOutputs, Proof } from "@kakure/ecash";
import { commit, type EntryRef, loadEntries } from "@/features/vault/vault-db";

/**
 * The chip wallet's records in the device vault (plan §00). Chips are bearer money, so they live only on this device,
 * encrypted, under the same lock, backup and Forget as tickets.
 */
export type WalletRecord = ChipRecord | DepositRecord | SpendRecord | PositionRecord;

/** A spendable chip. `key` is its `Y` (hash_to_curve of the secret), the same key the mint keeps. */
export interface ChipRecord {
  kind: "chip";
  network: Network;
  key: string;
  proof: Proof;
  createdAt: number;
  /** Imported from a backup: held apart until the mint says it's unspent (it may have been spent since). */
  recheck?: true;
}

/** Blinding factors are bigints; stored as hex. */
export interface StoredPending {
  outputs: PendingOutputs["outputs"];
  secrets: string[];
  rs: string[];
}

/** A deposit from this device: its id (a bearer secret, only ever in the memo), and the outputs a mint is waiting on. */
export interface DepositRecord {
  kind: "deposit";
  network: Network;
  /** The deposit id: 16 random bytes, hex. */
  key: string;
  amountZat: string;
  address: string;
  createdAt: number;
  state: "awaiting" | "minting" | "done";
  /** Outputs sent (or about to be) to the mint; kept until its signatures are in, so a resend gets the same answer. */
  pending?: StoredPending;
  mintedZat?: string;
}

/** A spend in flight (swap, withdrawal, trade): its inputs are out of the balance until the mint answers. */
export interface SpendRecord {
  kind: "spend";
  network: Network;
  key: string;
  purpose: "swap" | "withdraw";
  inputs: Proof[];
  /** The exact request body, so a retry resends it byte for byte (NUT-19). */
  request: string;
  /** Change or new chips the mint will sign, for a swap. */
  pending?: StoredPending;
  createdAt: number;
}

/** What the operator signs when a trade or a parlay buys a position (services/operator/src/positions.rs). */
export interface PositionCertificate {
  id: string;
  kind: "single" | "parlay";
  window?: string;
  side?: "U" | "D";
  legs?: { window: string; side: "U" | "D"; askE4: number; expiry: number }[];
  stakeZat: string;
  askE4?: number;
  priceE8?: number;
  payoutZat: string;
  openedAt: number;
  lock: string;
  sig: string;
}

/** The exits a position can carry (Owarine's trail, stop and take-profit). */
export interface ExitPlan {
  trail?: { bps: number; slippageBps: number };
  stop?: { price: number };
  takeProfit?: { bidE4: number };
}

/**
 * A position from this device, keyed by its lock (known before the trade is sent). The secret is the bearer authority:
 * it lives only here, and in a backup. `pending` is a request in flight, kept until its answer is in, so a closed tab
 * resends it byte for byte (the mint answers from its cache).
 */
export interface PositionRecord {
  kind: "position";
  network: Network;
  /** SHA-256 of the secret, hex. */
  key: string;
  secret: string;
  createdAt: number;
  /** open: held; armed: an exit waits at the mint; paid: closed or redeemed (kept as history). */
  state: "buying" | "open" | "armed" | "paid";
  certificate?: PositionCertificate;
  /** The asset price this device saw when it bought (display only: the chart's Entry line and PnL band). */
  entrySpot?: number;
  exit?: ExitPlan;
  /** Blank outputs left with the mint for an armed exit's proceeds. */
  exitBlank?: StoredPending;
  pending?: {
    path: "/v1/trade" | "/v1/parlay" | "/v1/close" | "/v1/redeem" | "/v1/exit";
    request: string;
    /** A buy's inputs (out of the balance until it's answered) and change outputs. */
    inputs?: Proof[];
    change?: StoredPending;
    /** Blank outputs for a close's or a redeem's proceeds, or an exit being armed. */
    blank?: StoredPending;
  };
  paidZat?: string;
  how?: string;
  paidAt?: number;
  /** Partial closes (Reduce), oldest first: what each paid and the stake it took off (this device's history). */
  reductions?: { at: number; paidZat: string; stakeZat: string }[];
}

const TYPES = ["chip", "deposit", "spend", "position"] as const;

export async function loadWallet(network: Network): Promise<WalletRecord[]> {
  return (await loadEntries<WalletRecord>(network, TYPES)).map((entry) => entry.value);
}

/** Writes `puts` and removes `deletes` in one transaction: all of it, or none. */
export function commitWallet(
  network: Network,
  puts: readonly WalletRecord[],
  deletes: readonly Pick<WalletRecord, "kind" | "key">[] = [],
): Promise<void> {
  return commit(
    network,
    puts.map((record) => ({ type: record.kind, key: record.key, value: record })),
    deletes.map((record): EntryRef => ({ type: record.kind, key: record.key })),
  );
}

/** A chip from a backup file, held apart until the mint confirms it unspent. */
export function importedChip(chip: ChipRecord, network: Network): ChipRecord {
  return { ...chip, network, recheck: true };
}
