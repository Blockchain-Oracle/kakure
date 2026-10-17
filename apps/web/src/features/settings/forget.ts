"use client";

import { STORAGE_PREFIX } from "@/constants";
import { deleteTicketDatabase } from "@/features/tickets/ticket-db";

/**
 * Forget this device (surfaces.md Settings): the encrypted ticket store and its keys, every `kakure.*` key in
 * localStorage (network, theme, preferences, the persisted public cache, played-cue memory), the service worker's
 * caches and the worker itself. Then a fresh start.
 */
export async function forgetThisDevice(): Promise<void> {
  await deleteTicketDatabase();
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
