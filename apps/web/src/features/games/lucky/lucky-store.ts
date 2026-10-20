"use client";

import type { LuckyDraw, LuckyResult } from "@kakure/arcade";
import type { Network } from "@kakure/domain";
import { useSyncExternalStore } from "react";
import { commit, loadEntries, onVaultReset } from "@/features/vault/vault-db";
import type { PositionRecord } from "@/features/wallet/records";
import { safeStorage } from "@/lib/storage";
import { gameKey } from "../keys";
import { DRAWS_KEPT } from "./constants";

/**
 * Lucky's draws on this device (plan §0 R5: "draws stay on the device"): what each spin was keyed by and drew, and,
 * once placed, the position it became. A placed draw names a position's key, its Window, side, stake and time, which
 * are the operator's records too, so each draw is an encrypted vault entry (like Replay's episodes), under the vault's
 * one lock: with the passphrase on, this browser's files show only ciphertext. Backups carry money and positions, not
 * these. A locked vault keeps the draws for this tab only. Its result is read from the vault's own position, never
 * stored twice. Forget this device clears them with the rest of the vault.
 */
export interface KeptDraw {
  at: number;
  network: Network;
  bundleSeq: number;
  bundleHash: string;
  seed: string;
  candidateHash: string;
  candidates: number;
  draw: LuckyDraw;
  windowId: string | null;
  dealtAskE4: number | null;
  stakeZat: number;
  /** The position's key once placed. */
  positionKey: string | null;
}

interface Store {
  draws: KeptDraw[];
}

const stores = new Map<Network, Store>();
const listeners = new Set<() => void>();

/** Draws were once kept in plain localStorage; whatever an earlier build left there is removed. */
const LEGACY_KEY = gameKey("lucky");
let legacyCleared = false;

function storeOf(network: Network): Store {
  let store = stores.get(network);
  if (!store) {
    const created: Store = { draws: [] };
    stores.set(network, created);
    store = created;
    if (!legacyCleared) {
      safeStorage.removeItem(LEGACY_KEY);
      legacyCleared = true;
    }
    void loadEntries<KeptDraw>(network, ["lucky"])
      .then((entries) => {
        const live = created.draws;
        const saved = entries.map((e) => e.value).filter((d) => !live.some((x) => x.seed === d.seed));
        created.draws = [...live, ...saved].sort((a, b) => b.at - a.at).slice(0, DRAWS_KEPT);
        notify();
      })
      .catch(() => {
        // A locked or unavailable vault: draws last for this tab.
      });
  }
  return store;
}

onVaultReset(() => {
  stores.clear();
  notify();
});

function notify(): void {
  for (const listener of listeners) listener();
}

/** Writes one draw and drops whatever falls past the newest `DRAWS_KEPT`, in one vault transaction. */
function save(network: Network, draw: KeptDraw, next: KeptDraw[]): void {
  const store = storeOf(network);
  const kept = next.slice(0, DRAWS_KEPT);
  const dropped = next.slice(DRAWS_KEPT);
  store.draws = kept;
  notify();
  void commit(
    network,
    [{ type: "lucky", key: draw.seed, value: draw }],
    dropped.map((d) => ({ type: "lucky" as const, key: d.seed })),
  ).catch(() => {
    // A locked or full vault: this draw lasts for this tab.
  });
}

export function keepDraw(draw: KeptDraw): void {
  save(draw.network, draw, [draw, ...storeOf(draw.network).draws]);
}

/** Marks the draw with this seed as placed, with its position. */
export function markPlaced(network: Network, seed: string, positionKey: string): void {
  const draws = storeOf(network).draws;
  const placed = draws.find((d) => d.seed === seed);
  if (!placed) return;
  const next = { ...placed, positionKey };
  save(
    network,
    next,
    draws.map((d) => (d === placed ? next : d)),
  );
}

const NONE: KeptDraw[] = [];

export function useKeptDraws(network: Network): KeptDraw[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => storeOf(network).draws,
    () => NONE,
  );
}

/** A placed draw's result, from its position in the vault: riding until it's paid, then what the close decided. */
export function resultOf(position: PositionRecord | undefined): LuckyResult | null {
  if (!position?.certificate) return null;
  if (position.state !== "paid") return "riding";
  const paid = Number(position.paidZat ?? 0);
  const stake = Number(position.certificate.stakeZat);
  if (position.how !== "redeem" && position.how !== "settled") return "closed";
  if (paid === stake) return "refund";
  return paid > stake ? "won" : "lost";
}
