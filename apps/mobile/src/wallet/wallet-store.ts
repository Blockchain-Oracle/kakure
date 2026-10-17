import type { Network } from "@kakure/domain";
import * as Zingo from "@zingo";
import { AppState } from "react-native";
import { SYNC_MAX_POLLS, SYNC_POLL_MS, WALLET_SERVER, WALLET_SYNC_EVERY_MS } from "@/constants";
import { devLog } from "@/lib/dev-log";
import { createStore, useStore } from "@/lib/store";
import { networkStore } from "@/network/network-store";

/**
 * The in-app wallet (C10) for the active network. The binding holds one wallet at a time, so a network switch
 * re-opens the other network's own wallet (plan §13.16: separate wallets per network). Seeds never reach JS
 * except on the backup screen. Every native failure lands in `error` with its code, never as a crash.
 */
export type WalletPhase = "unknown" | "opening" | "absent" | "ready" | "error";

export interface Pools {
  ironwood: bigint;
  ironwoodConfirmed: bigint;
  orchard: bigint;
  orchardConfirmed: bigint;
  sapling: bigint;
  transparent: bigint;
  /** What the wallet can spend now (all shielded pools it would use). */
  spendable: bigint;
}

export interface WalletState {
  network: Network;
  phase: WalletPhase;
  birthday: number | null;
  error: { code: string; message: string } | null;
  address: string | null;
  pools: Pools | null;
  balanceAt: number | null;
  sync: {
    phase: "idle" | "running" | "complete";
    percent: number;
    walletHeight: number | null;
    serverHeight: number | null;
    at: number | null;
  };
  mixnet: "off" | "warming" | "ready" | "failed";
  activity: Zingo.ValueTransfer[];
}

const IDLE_SYNC = { phase: "idle", percent: 0, walletHeight: null, serverHeight: null, at: null } as const;

function blank(network: Network): WalletState {
  return {
    network,
    phase: "unknown",
    birthday: null,
    error: null,
    address: null,
    pools: null,
    balanceAt: null,
    sync: { ...IDLE_SYNC },
    mixnet: "off",
    activity: [],
  };
}

export const walletStore = createStore<WalletState>(blank(networkStore.get()));
export const useWallet = () => useStore(walletStore);

const patch = (next: Partial<WalletState>) => walletStore.set((state) => ({ ...state, ...next }));

export function errorOf(error: unknown): { code: string; message: string } {
  const value = error as { code?: string; message?: string };
  return { code: value?.code ?? "ERR_UNKNOWN", message: value?.message ?? String(error) };
}

const zat = (value: number | null | undefined) => BigInt(Math.max(0, Math.round(value ?? 0)));

function poolsOf(balance: Zingo.Balance): Pools {
  const p = balance.pools;
  return {
    ironwood: zat(p.total_ironwood_balance),
    ironwoodConfirmed: zat(p.confirmed_ironwood_balance),
    orchard: zat(p.total_orchard_balance),
    orchardConfirmed: zat(p.confirmed_orchard_balance),
    sapling: zat(p.total_sapling_balance),
    transparent: zat(p.total_transparent_balance),
    spendable: zat(balance.spendable?.spendable_balance),
  };
}

/** Reads balance and activity (cheap; no network). */
export async function refreshWallet(): Promise<void> {
  if (walletStore.get().phase !== "ready") return;
  try {
    const [balance, activity] = await Promise.all([Zingo.balance(), Zingo.activity()]);
    patch({ pools: poolsOf(balance), balanceAt: Date.now(), activity: activity.transfers ?? [] });
  } catch (error) {
    patch({ error: errorOf(error) });
  }
}

let syncing: Promise<void> | null = null;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Syncs to the tip (bounded), then refreshes balance and activity. Concurrent callers share one run. */
export function syncWallet(): Promise<void> {
  if (walletStore.get().phase !== "ready") return Promise.resolve();
  syncing ??= (async () => {
    try {
      await Zingo.sync();
      for (let poll = 0; poll < SYNC_MAX_POLLS; poll += 1) {
        const status = await Zingo.syncStatus();
        patch({
          sync: {
            phase: status.phase,
            percent: status.progress.percentage_total_blocks_scanned ?? 0,
            walletHeight: status.walletHeight,
            serverHeight: status.serverHeight,
            at: Date.now(),
          },
        });
        if (status.phase !== "running") break;
        await wait(SYNC_POLL_MS);
      }
      await refreshWallet();
    } catch (error) {
      patch({ error: errorOf(error) });
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Brings the Nym mixnet up ahead of a bet (plan: pre-warm at launch, so a bet pays only prove-and-send). */
export async function warmMixnet(): Promise<void> {
  const state = walletStore.get();
  if (state.phase !== "ready" || state.mixnet === "warming" || state.mixnet === "ready") return;
  patch({ mixnet: "warming" });
  try {
    const warm = await Zingo.warmMixnet();
    devLog(`mixnet ${warm.mixnet_indicator} (proxy ${warm.proxyStartMs} ms, ready ${warm.readyMs} ms)`);
    patch({ mixnet: warm.mixnet_indicator === "ready" ? "ready" : "failed" });
  } catch (error) {
    devLog(`mixnet failed: ${errorOf(error).code}: ${errorOf(error).message}`);
    patch({ mixnet: "failed" });
  }
}

async function afterOpen(): Promise<void> {
  try {
    const address = await Zingo.getAddress();
    patch({ address: address.address });
  } catch (error) {
    patch({ error: errorOf(error) });
  }
  await refreshWallet();
  void warmMixnet();
  void syncWallet();
}

/** Opens this network's saved wallet, if any. Never creates one. */
export async function openWallet(network: Network = networkStore.get()): Promise<WalletPhase> {
  walletStore.set({ ...blank(network), phase: "opening" });
  try {
    const opened = await Zingo.openWallet(network, WALLET_SERVER[network]);
    if (networkStore.get() !== network) return "unknown";
    if (opened.status === "absent") {
      patch({ phase: "absent" });
      return "absent";
    }
    patch({ phase: "ready", birthday: opened.birthday ?? null });
    void afterOpen();
    return "ready";
  } catch (error) {
    patch({ phase: "error", error: errorOf(error) });
    return "error";
  }
}

export async function createWallet(network: Network): Promise<void> {
  walletStore.set({ ...blank(network), phase: "opening" });
  try {
    const created = await Zingo.createWallet(network, WALLET_SERVER[network]);
    patch({ phase: "ready", birthday: created.birthday ?? null });
    void afterOpen();
  } catch (error) {
    patch({ phase: "error", error: errorOf(error) });
    throw error;
  }
}

export async function restoreWallet(network: Network, phrase: string, birthday: number): Promise<void> {
  walletStore.set({ ...blank(network), phase: "opening" });
  try {
    const restored = await Zingo.restoreWallet(network, WALLET_SERVER[network], phrase, birthday);
    patch({ phase: "ready", birthday: restored.birthday ?? null });
    void afterOpen();
  } catch (error) {
    patch({ phase: "absent", error: errorOf(error) });
    throw error;
  }
}

export async function forgetWallet(network: Network): Promise<void> {
  await Zingo.forgetWallet(network);
  if (walletStore.get().network === network) walletStore.set({ ...blank(network), phase: "absent" });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the wallet's life cycle: open now, sync on a clock in the foreground, re-open on a network switch. */
export function startWallet(): () => void {
  const state = walletStore.get();
  // First run may have just created or opened it; re-opening would drop the warmed mixnet.
  if (state.phase !== "ready" || state.network !== networkStore.get()) void openWallet();
  const unsubscribeNetwork = networkStore.subscribe(() => void openWallet(networkStore.get()));
  timer = setInterval(() => {
    if (AppState.currentState === "active") void syncWallet();
  }, WALLET_SYNC_EVERY_MS);
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void syncWallet();
      void warmMixnet();
    }
  });
  return () => {
    unsubscribeNetwork();
    appState.remove();
    if (timer) clearInterval(timer);
    timer = null;
  };
}
