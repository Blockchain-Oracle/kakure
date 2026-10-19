"use client";

import type { Network } from "@kakure/domain";
import type { PendingOutputs, Proof } from "@kakure/ecash";
import { commit, type EntryRef, loadEntries } from "@/features/vault/vault-db";

/**
 * The chip wallet's records in the device vault (plan §00). Chips are bearer money, so they live only on this device,
 * encrypted, under the same lock, backup and Forget as tickets.
 */
export type WalletRecord = ChipRecord | DepositRecord | SpendRecord;

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

const TYPES = ["chip", "deposit", "spend"] as const;

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
