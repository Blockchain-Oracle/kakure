"use client";

import { type Network, type Trading, WITHDRAW_GRID_ZAT } from "@kakure/domain";
import {
  type BlindSignature,
  finishOutputs,
  type PendingOutputs,
  type Proof,
  prepareOutputs,
  select,
  total,
} from "@kakure/ecash";
import { MintError, mintCall } from "./api";
import type { SpendRecord } from "./records";
import { resumePositions } from "./trading";
import {
  apply,
  chipRecords,
  current,
  exclusive,
  keysetOf,
  randomKey,
  restore,
  spentYs,
  stillUnspent,
  store,
} from "./wallet-store";

/**
 * Spending chips that leave the wallet (plan §00): swaps for exact amounts and shielded withdrawals. Each spend is
 * recorded with its exact request before it's sent; a refusal puts back what is still unspent.
 */

/** The most a withdrawal of the whole balance can be: whole steps of 0.001 ZEC (each note is its own transaction). */
export function withdrawable(balanceZat: number): number {
  return Math.floor(balanceZat / WITHDRAW_GRID_ZAT) * WITHDRAW_GRID_ZAT;
}

async function refund(network: Network, trading: Trading, spend: SpendRecord, error: MintError) {
  const inputs = await stillUnspent(network, trading, spend.inputs, error);
  await apply(network, chipRecords(network, inputs), [spend]);
}

/**
 * Chips worth exactly `zat`, swapping for change when the chips on hand don't add up to it exactly. The inputs leave
 * the balance before the call; the new chips (and the change) arrive in the same commit that clears the spend.
 */
async function exactChips(network: Network, trading: Trading, zat: number): Promise<Proof[]> {
  const keyset = keysetOf(trading);
  const wallet = await current(network);
  const inputs = select(
    wallet.chips.map((chip) => chip.proof),
    zat,
  );
  if (!inputs) throw new Error("Not enough chips for that amount.");
  if (total(inputs) === zat) return inputs;
  const pay = prepareOutputs(keyset, zat);
  const change = prepareOutputs(keyset, total(inputs) - zat);
  const pending: PendingOutputs = {
    outputs: [...pay.outputs, ...change.outputs],
    secrets: [...pay.secrets, ...change.secrets],
    rs: [...pay.rs, ...change.rs],
  };
  const spend: SpendRecord = {
    kind: "spend",
    network,
    key: randomKey(),
    purpose: "swap",
    inputs,
    request: JSON.stringify({ inputs, outputs: pending.outputs }),
    pending: store(pending),
    createdAt: Date.now(),
  };
  await apply(network, [spend], chipRecords(network, inputs));
  const fresh = await settleSwap(network, trading, spend);
  return fresh.slice(0, pay.outputs.length);
}

async function settleSwap(network: Network, trading: Trading, spend: SpendRecord): Promise<Proof[]> {
  const keyset = keysetOf(trading);
  if (!spend.pending) throw new Error("A swap without outputs.");
  try {
    const answer = await mintCall<{ signatures: BlindSignature[] }>(
      network,
      trading,
      "POST",
      "/v1/swap",
      spend.request,
    );
    const chips = finishOutputs(keyset, restore(spend.pending), answer.signatures);
    await apply(network, chipRecords(network, chips), [spend]);
    return chips;
  } catch (error) {
    if (error instanceof MintError && error.refused) await refund(network, trading, spend, error);
    throw error;
  }
}

/** Sends `zat` of chips to a fresh shielded address, paid as canonical notes at random times (plan §00). */
export function withdraw(
  network: Network,
  trading: Trading,
  zat: number,
  address: string,
): Promise<{ amountZat: string; withinSecs: number }> {
  return exclusive(network, async () => {
    if (zat % WITHDRAW_GRID_ZAT !== 0) throw new Error("Withdrawals go in steps of 0.001.");
    const inputs = await exactChips(network, trading, zat);
    const spend: SpendRecord = {
      kind: "spend",
      network,
      key: randomKey(),
      purpose: "withdraw",
      inputs,
      request: JSON.stringify({ inputs, address }),
      createdAt: Date.now(),
    };
    await apply(network, [spend], chipRecords(network, inputs));
    return settleWithdraw(network, trading, spend);
  });
}

async function settleWithdraw(network: Network, trading: Trading, spend: SpendRecord) {
  try {
    const answer = await mintCall<{ amountZat: string; withinSecs: number }>(
      network,
      trading,
      "POST",
      "/v1/melt/zcash",
      spend.request,
    );
    await apply(network, [], [spend]);
    return answer;
  } catch (error) {
    if (error instanceof MintError && error.refused) await refund(network, trading, spend, error);
    throw error;
  }
}

/**
 * Finishes what a closed tab left in flight (each request resent as it was; the mint answers from its cache), collects
 * what positions earned while it was closed, and asks the mint about chips imported from a backup: unspent ones join
 * the balance, spent ones are dropped.
 */
export function resumeWallet(network: Network, trading: Trading): Promise<void> {
  return exclusive(network, async () => {
    const wallet = await current(network);
    for (const spend of wallet.spends) {
      try {
        if (spend.purpose === "swap") await settleSwap(network, trading, spend);
        else await settleWithdraw(network, trading, spend);
      } catch {
        // Unreachable, or refused (and refunded): an unreachable one is tried again next time.
      }
    }
    await resumePositions(network, trading);
    if (wallet.rechecking.length === 0) return;
    const spent = await spentYs(
      network,
      trading,
      wallet.rechecking.map((chip) => chip.proof),
    );
    const kept = wallet.rechecking.filter((chip) => !spent.has(chip.key)).map(({ recheck: _, ...chip }) => chip);
    const dropped = wallet.rechecking.filter((chip) => spent.has(chip.key));
    await apply(network, kept, dropped);
  });
}
