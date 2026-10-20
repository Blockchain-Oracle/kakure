"use client";

import { type Network, type Trading, toHex } from "@kakure/domain";
import { checkKeyset, chipY, type PendingOutputs, type Proof, total } from "@kakure/ecash";
import { useSyncExternalStore } from "react";
import { onVaultReset, VaultLockedError } from "@/features/vault/vault-db";
import { MINT_CODES, type MintError, mintCall } from "./api";
import {
  type ChipRecord,
  commitWallet,
  type DepositRecord,
  loadWallet,
  type PositionRecord,
  type SpendRecord,
  type StoredPending,
  type WalletRecord,
} from "./records";

/**
 * The chip wallet's core (plan §00): chips, deposits, spends and positions per network, kept in the device vault and in
 * memory for the screens. Every operation (deposits.ts, spending.ts, trading.ts) records its intent before it calls the
 * mint and settles it after, so a closed tab or a lost answer never loses value: an in-flight request is resent byte for
 * byte, and the mint answers a resend from its cache (NUT-19, kept 2 days). A refusal (the mint answered "no") puts
 * back what is still unspent.
 *
 * Operations on one network run one at a time (`exclusive`), so two spends can never pick the same chips.
 */
const ID_BYTES = 16;
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
  /** Newest first: held, armed, in flight, and paid ones kept as this device's history. */
  positions: PositionRecord[];
}

const EMPTY: WalletView = {
  status: "loading",
  balanceZat: 0,
  chips: [],
  rechecking: [],
  deposits: [],
  spends: [],
  positions: [],
};
const views = new WeakMap<WalletRecord[], WalletView>();

const newestFirst = (a: { createdAt: number }, b: { createdAt: number }) => b.createdAt - a.createdAt;

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
    deposits: loaded.filter((r): r is DepositRecord => r.kind === "deposit").sort(newestFirst),
    spends: loaded.filter((r): r is SpendRecord => r.kind === "spend"),
    positions: loaded.filter((r): r is PositionRecord => r.kind === "position").sort(newestFirst),
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
export async function current(network: Network): Promise<WalletView> {
  if (!Array.isArray(states.get(network))) await refresh(network);
  const loaded = states.get(network);
  if (loaded === "locked") throw new VaultLockedError("The vault is locked.");
  if (!Array.isArray(loaded)) throw new Error("This browser can't open the vault.");
  return view(loaded);
}

const queues = new Map<Network, Promise<unknown>>();

/** Runs wallet operations on one network one after another. */
export function exclusive<T>(network: Network, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(network) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    network,
    next.catch(() => undefined),
  );
  return next;
}

/** Commits records (one IndexedDB transaction) and refreshes every screen. */
export async function apply(
  network: Network,
  puts: WalletRecord[],
  deletes: Pick<WalletRecord, "kind" | "key">[] = [],
): Promise<void> {
  await commitWallet(network, puts, deletes);
  await refresh(network);
}

export function store(pending: PendingOutputs): StoredPending {
  return { outputs: pending.outputs, secrets: pending.secrets, rs: pending.rs.map((r) => r.toString(HEX)) };
}

export function restore(stored: StoredPending): PendingOutputs {
  return { outputs: stored.outputs, secrets: stored.secrets, rs: stored.rs.map((r) => BigInt(`0x${r}`)) };
}

export function chipRecords(network: Network, proofs: readonly Proof[]): ChipRecord[] {
  const now = Date.now();
  return proofs.map((proof) => ({ kind: "chip", network, key: chipY(proof), proof, createdAt: now }));
}

export function keysetOf(trading: Trading) {
  if (!checkKeyset(trading.keyset)) throw new Error("The signed keyset's id doesn't match its keys.");
  return trading.keyset;
}

export function randomKey(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

/** Which of these chips the mint has seen spent (NUT-07), by `Y`. Asked in batches of the mint's item limit. */
export async function spentYs(network: Network, trading: Trading, proofs: readonly Proof[]): Promise<Set<string>> {
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
 * After a refused spend, the inputs that are still the wallet's. "Already spent" means some were spent elsewhere
 * (another device with the same backup), so the mint is asked which; any other refusal spent nothing.
 */
export async function stillUnspent(
  network: Network,
  trading: Trading,
  inputs: readonly Proof[],
  error: MintError,
): Promise<Proof[]> {
  if (error.code !== MINT_CODES.alreadySpent) return [...inputs];
  const spent = await spentYs(network, trading, inputs);
  return inputs.filter((proof) => !spent.has(chipY(proof)));
}
