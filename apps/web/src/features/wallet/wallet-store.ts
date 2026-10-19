"use client";

import { buildPaymentUri, type Network, type Trading, toHex } from "@kakure/domain";
import {
  type BlindSignature,
  checkKeyset,
  chipY,
  finishOutputs,
  type PendingOutputs,
  type Proof,
  prepareOutputs,
  select,
  total,
} from "@kakure/ecash";
import { useSyncExternalStore } from "react";
import { onVaultReset, VaultLockedError } from "@/features/vault/vault-db";
import { MINT_CODES, MintError, mintCall } from "./api";
import {
  type ChipRecord,
  commitWallet,
  type DepositRecord,
  loadWallet,
  type SpendRecord,
  type StoredPending,
  type WalletRecord,
} from "./records";

/**
 * The chip wallet (plan §00): chips, deposits and spends in flight per network, kept in the device vault and in memory
 * for the screens. Every operation records its intent before it calls the mint and settles it after, so a closed tab
 * or a lost answer never loses value: an in-flight request is resent byte for byte, and the mint answers a resend from
 * its cache (NUT-19, kept 2 days). A refusal (the mint answered "no") puts back what is still unspent.
 *
 * Operations on one network run one at a time, so two spends can never pick the same chips.
 */
const ID_BYTES = 16;
/** The smallest chip (0.001 ZEC): a deposit's mintable amount is rounded down to whole chips. */
const CHIP_GRID_ZAT = 100_000;
/** The mint takes at most this many items per request (services/operator/src/mint.rs MAX_ITEMS). */
const MAX_ITEMS = 64;
const HEX = 16;

type Loaded = WalletRecord[] | null | "unavailable" | "locked";
const states = new Map<Network, Loaded>();
const loading = new Set<Network>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

onVaultReset(() => {
  states.clear();
  notify();
});

async function refresh(network: Network) {
  try {
    states.set(network, await loadWallet(network));
  } catch (error) {
    states.set(network, error instanceof VaultLockedError ? "locked" : "unavailable");
  }
  notify();
}

function ensure(network: Network) {
  if (states.has(network) || loading.has(network) || typeof indexedDB === "undefined") return;
  loading.add(network);
  void refresh(network).finally(() => loading.delete(network));
}

export interface WalletView {
  status: "loading" | "unavailable" | "locked" | "ready";
  /** Spendable chips, in zatoshi. */
  balanceZat: number;
  chips: ChipRecord[];
  /** Chips from a backup the mint hasn't confirmed unspent yet (not in the balance). */
  rechecking: ChipRecord[];
  deposits: DepositRecord[];
  spends: SpendRecord[];
}

const EMPTY: WalletView = { status: "loading", balanceZat: 0, chips: [], rechecking: [], deposits: [], spends: [] };
const views = new WeakMap<WalletRecord[], WalletView>();

function view(loaded: Loaded | undefined): WalletView {
  if (loaded === null || loaded === undefined) return EMPTY;
  if (loaded === "unavailable" || loaded === "locked") return { ...EMPTY, status: loaded };
  const cached = views.get(loaded);
  if (cached) return cached;
  const allChips = loaded.filter((r): r is ChipRecord => r.kind === "chip");
  const chips = allChips.filter((chip) => !chip.recheck);
  const next: WalletView = {
    status: "ready",
    chips,
    rechecking: allChips.filter((chip) => chip.recheck),
    deposits: loaded.filter((r): r is DepositRecord => r.kind === "deposit").sort((a, b) => b.createdAt - a.createdAt),
    spends: loaded.filter((r): r is SpendRecord => r.kind === "spend"),
    balanceZat: total(chips.map((chip) => chip.proof)),
  };
  views.set(loaded, next);
  return next;
}

const STATIC = () => EMPTY;

export function useWallet(network: Network): WalletView {
  ensure(network);
  return useSyncExternalStore(subscribe, () => view(states.get(network)), STATIC);
}

/** The wallet as stored, loading it first if needed. */
async function current(network: Network): Promise<WalletView> {
  if (!Array.isArray(states.get(network))) await refresh(network);
  const loaded = states.get(network);
  if (loaded === "locked") throw new VaultLockedError("The vault is locked.");
  if (!Array.isArray(loaded)) throw new Error("This browser can't open the vault.");
  return view(loaded);
}

const queues = new Map<Network, Promise<unknown>>();

/** Runs wallet operations on one network one after another. */
function exclusive<T>(network: Network, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(network) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    network,
    next.catch(() => undefined),
  );
  return next;
}

async function apply(network: Network, puts: WalletRecord[], deletes: Pick<WalletRecord, "kind" | "key">[] = []) {
  await commitWallet(network, puts, deletes);
  await refresh(network);
}

function store(pending: PendingOutputs): StoredPending {
  return { outputs: pending.outputs, secrets: pending.secrets, rs: pending.rs.map((r) => r.toString(HEX)) };
}

function restore(stored: StoredPending): PendingOutputs {
  return { outputs: stored.outputs, secrets: stored.secrets, rs: stored.rs.map((r) => BigInt(`0x${r}`)) };
}

function chipRecords(network: Network, proofs: readonly Proof[]): ChipRecord[] {
  const now = Date.now();
  return proofs.map((proof) => ({ kind: "chip", network, key: chipY(proof), proof, createdAt: now }));
}

function keysetOf(trading: Trading) {
  if (!checkKeyset(trading.keyset)) throw new Error("The signed keyset's id doesn't match its keys.");
  return trading.keyset;
}

function randomKey(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

/** Which of these chips the mint has seen spent (NUT-07), by `Y`. Asked in batches of the mint's item limit. */
async function spentYs(network: Network, trading: Trading, proofs: readonly Proof[]): Promise<Set<string>> {
  const spent = new Set<string>();
  for (let i = 0; i < proofs.length; i += MAX_ITEMS) {
    const ys = proofs.slice(i, i + MAX_ITEMS).map(chipY);
    const answer = await mintCall<{ states: { Y: string; state: "SPENT" | "UNSPENT" | "PENDING" }[] }>(
      network,
      trading,
      "POST",
      "/v1/checkstate",
      JSON.stringify({ Ys: ys }),
    );
    for (const item of answer.states) if (item.state !== "UNSPENT") spent.add(item.Y);
  }
  return spent;
}

/**
 * After a refused spend, puts back the inputs that are still unspent. "Already spent" means some of them were spent
 * elsewhere (another device with the same backup), so the mint is asked which.
 */
async function refund(network: Network, trading: Trading, spend: SpendRecord, error: MintError) {
  let inputs = spend.inputs;
  if (error.code === MINT_CODES.alreadySpent) {
    const spent = await spentYs(network, trading, inputs);
    inputs = inputs.filter((proof) => !spent.has(chipY(proof)));
  }
  await apply(network, chipRecords(network, inputs), [spend]);
}

/* ── Deposits ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A new deposit: its id is drawn here and saved before the QR is shown, so a closed tab can still mint it later. */
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

/* ── Spending ────────────────────────────────────────────────────────────────────────────────────────────────── */

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
 * Finishes what a closed tab left in flight (each request resent as it was; the mint answers from its cache), then
 * asks the mint about chips imported from a backup: unspent ones join the balance, spent ones are dropped.
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
