"use client";

import { NETWORKS } from "@kakure/domain";
import { STORAGE_PREFIX } from "@/constants";
import { retractReceipt } from "@/features/games/bets/api";
import { playerKey } from "@/features/games/player/device-key";
import { deleteVault, loadEntries, VaultLockedError } from "@/features/vault/vault-db";
import type { PositionRecord } from "@/features/wallet/records";

/** Taking calls off the Bets board is tried for this long, so Forget never hangs on a slow arcade. */
const RETRACT_WITHIN_MS = 8_000;

/** What taking this device's published calls down left behind. */
export interface TakeDown {
  /** Calls still on the board: the arcade couldn't be reached, or refused. */
  stranded: number;
  /** The vault is locked, so this device can't tell whether it published any. */
  locked: boolean;
}

/**
 * Calls this device published to the Bets board come down first (plan §0 R7): once the arcade key is gone, nobody could
 * take them back. Forget asks again before deleting the key when any are left up or the vault can't be read.
 */
export async function takeDownPublished(): Promise<TakeDown> {
  const player = playerKey();
  let stranded = 0;
  let locked = false;
  const work = (async () => {
    for (const network of NETWORKS) {
      let positions: { value: PositionRecord }[] = [];
      try {
        positions = await loadEntries<PositionRecord>(network, ["position"]);
      } catch (cause) {
        if (cause instanceof VaultLockedError) locked = true;
      }
      for (const { value } of positions) {
        if (value.published?.player !== player) continue;
        await retractReceipt(value.published.receipt).catch(() => {
          stranded += 1;
        });
      }
    }
  })();
  const timedOut = await Promise.race([
    work.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), RETRACT_WITHIN_MS)),
  ]);
  return { stranded: timedOut ? Math.max(stranded, 1) : stranded, locked };
}

/**
 * Forget this device (surfaces.md Settings): the vault (chips, positions, deposits) and its keys, every `kakure.*` key
 * in localStorage (network, theme, preferences, the arcade key, the persisted public cache), the service worker's
 * caches and the worker itself. Then a fresh start. Run `takeDownPublished` first.
 */
export async function forgetThisDevice(): Promise<void> {
  await deleteVault();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing was stored.
  }
  try {
    for (const name of await caches.keys()) await caches.delete(name);
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  } catch {
    // No caches or worker here.
  }
  window.location.replace("/markets");
}
