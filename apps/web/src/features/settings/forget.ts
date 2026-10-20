"use client";

import { NETWORKS } from "@kakure/domain";
import { STORAGE_PREFIX } from "@/constants";
import { retractReceipt } from "@/features/games/bets/api";
import { playerKey } from "@/features/games/player/device-key";
import { deleteVault, loadEntries } from "@/features/vault/vault-db";
import type { PositionRecord } from "@/features/wallet/records";

/** Taking calls off the Bets board is tried for this long, so Forget never hangs on a slow arcade. */
const RETRACT_WITHIN_MS = 8_000;

/**
 * Calls this device published to the Bets board come down first (plan §0 R7): once the arcade key is gone, nobody
 * could take them back. Best effort: a locked vault or an unreachable arcade leaves them up.
 */
async function retractPublished(): Promise<void> {
  const player = playerKey();
  for (const network of NETWORKS) {
    const positions = await loadEntries<PositionRecord>(network, ["position"]).catch(() => []);
    for (const { value } of positions) {
      if (value.published?.player === player) await retractReceipt(value.published.receipt).catch(() => undefined);
    }
  }
}

/**
 * Forget this device (surfaces.md Settings): published Bets calls taken down, then the vault (chips, positions,
 * deposits) and its keys, every `kakure.*` key in localStorage (network, theme, preferences, the arcade key, the
 * persisted public cache), the service worker's caches and the worker itself. Then a fresh start.
 */
export async function forgetThisDevice(): Promise<void> {
  await Promise.race([retractPublished(), new Promise((resolve) => setTimeout(resolve, RETRACT_WITHIN_MS))]);
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
