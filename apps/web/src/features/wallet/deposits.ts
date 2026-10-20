"use client";

import { buildPaymentUri, CHIP_GRID_ZAT, type Network, type Trading } from "@kakure/domain";
import { type BlindSignature, finishOutputs, prepareOutputs, total } from "@kakure/ecash";
import { MintError, mintCall } from "./api";
import type { DepositRecord } from "./records";
import { apply, chipRecords, current, exclusive, keysetOf, randomKey, restore, store } from "./wallet-store";

/**
 * Deposits (plan §00): a shielded payment with a random id in its memo becomes blind-signed chips once it has its
 * confirmations. The id is drawn and saved before the code is shown, so a closed tab can still mint it later; the
 * outputs are saved before the mint is asked, so a lost answer is fetched again from the mint's cache.
 */

/** A new deposit: its id is drawn here and saved before the QR is shown. */
export function startDeposit(network: Network, trading: Trading, amountZat: bigint): Promise<DepositRecord> {
  return exclusive(network, async () => {
    if (!trading.depositAddress) throw new Error("Deposits are off on this network right now.");
    const record: DepositRecord = {
      kind: "deposit",
      network,
      key: randomKey(),
      amountZat: amountZat.toString(),
      address: trading.depositAddress,
      createdAt: Date.now(),
      state: "awaiting",
    };
    await apply(network, [record]);
    return record;
  });
}

export function depositUri(record: DepositRecord, trading: Trading): string {
  return buildPaymentUri({
    address: record.address,
    amountZat: BigInt(record.amountZat),
    memo: `${trading.depositMemoPrefix}${record.key}`,
  });
}

export interface DepositProgress {
  state: "unseen" | "confirming" | "confirmed";
  receivedZat: string;
  confirmations: number;
  needed: number;
  mintableZat: string;
}

export type DepositStep = DepositProgress | "minting" | "done";

/**
 * One step of a deposit, from its latest saved state: ask the mint how it stands, and once it can mint, mint it into
 * chips. Returns where it stands: the mint's progress, "minting" when signatures are pending, or "done".
 */
export function advanceDeposit(network: Network, trading: Trading, key: string): Promise<DepositStep> {
  return exclusive(network, async () => {
    const record = (await current(network)).deposits.find((deposit) => deposit.key === key);
    if (!record) throw new Error("This deposit isn't on this device.");
    if (record.state === "done") return "done";
    const keyset = keysetOf(trading);
    let pending = record.pending ? restore(record.pending) : null;
    if (!pending) {
      const progress = await mintCall<DepositProgress>(network, trading, "GET", `/v1/deposit/${record.key}`);
      const mintable = Number(progress.mintableZat) - (Number(progress.mintableZat) % CHIP_GRID_ZAT);
      if (mintable <= 0) {
        // Confirmed with nothing left to mint: it was minted (by this device's earlier answer or a backup's copy).
        if (progress.state === "confirmed" && record.mintedZat !== undefined) {
          await apply(network, [{ ...record, state: "done" }]);
          return "done";
        }
        return progress;
      }
      pending = prepareOutputs(keyset, mintable);
      // Saved before the call: if the answer is lost, the same outputs are resent and the mint answers from its cache.
      await apply(network, [{ ...record, state: "minting", pending: store(pending) }]);
    }
    const request = JSON.stringify({ deposit: record.key, outputs: pending.outputs });
    try {
      const answer = await mintCall<{ signatures: BlindSignature[] }>(
        network,
        trading,
        "POST",
        "/v1/mint/zcash",
        request,
      );
      const chips = finishOutputs(keyset, pending, answer.signatures);
      const minted = BigInt(record.mintedZat ?? "0") + BigInt(total(chips));
      const { pending: _, ...rest } = record;
      await apply(network, [...chipRecords(network, chips), { ...rest, state: "done", mintedZat: minted.toString() }]);
      return "done";
    } catch (error) {
      if (error instanceof MintError && error.refused) {
        // The mint can't sign these (the chain moved back, or it already did): start again from its own numbers.
        const { pending: _, ...rest } = record;
        await apply(network, [{ ...rest, state: "awaiting", mintedZat: rest.mintedZat ?? "0" }]);
        return "minting";
      }
      throw error;
    }
  });
}

/** Removes a deposit that was never paid (its id only ever lived in the code shown). */
export function dropDeposit(network: Network, key: string): Promise<void> {
  return exclusive(network, () => apply(network, [], [{ kind: "deposit", key }]));
}
