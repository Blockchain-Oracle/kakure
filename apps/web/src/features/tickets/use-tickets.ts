"use client";

import type { Network } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { useSyncExternalStore } from "react";
import { onVaultReset, VaultLockedError } from "@/features/vault/vault-db";
import { loadTickets, saveTicket } from "./ticket-db";

/**
 * This device's tickets per network, loaded once from the vault and kept in memory.
 * `null` while loading (the page shows its skeleton); `"unavailable"` when storage is blocked; `"locked"` when the
 * optional passphrase lock is on and this tab hasn't unlocked it.
 */
type State = Ticket[] | null | "unavailable" | "locked";

const states = new Map<Network, State>();
const listeners = new Set<() => void>();
const loading = new Set<Network>();
const EMPTY: State = null;

function notify() {
  for (const listener of listeners) listener();
}

// A lock change, an import or Forget: read again.
onVaultReset(() => {
  states.clear();
  notify();
});

function ensure(network: Network) {
  if (states.has(network) || loading.has(network) || typeof indexedDB === "undefined") return;
  loading.add(network);
  loadTickets(network)
    .then((tickets) => states.set(network, tickets))
    .catch((error: unknown) => states.set(network, error instanceof VaultLockedError ? "locked" : "unavailable"))
    .finally(() => {
      loading.delete(network);
      notify();
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTickets(network: Network): State {
  ensure(network);
  return useSyncExternalStore(
    subscribe,
    () => states.get(network) ?? EMPTY,
    () => EMPTY,
  );
}

/** Saves a ticket, then updates every view. Throws if the device can't store it (the QR is never shown then). */
export async function addTicket(ticket: Ticket): Promise<void> {
  await saveTicket(ticket);
  const current = states.get(ticket.network);
  const list = Array.isArray(current) ? current.filter((item) => item.hash !== ticket.hash) : [];
  states.set(ticket.network, [ticket, ...list]);
  notify();
}
