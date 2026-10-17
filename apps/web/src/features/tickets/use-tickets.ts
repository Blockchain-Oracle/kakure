"use client";

import type { Network } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { useSyncExternalStore } from "react";
import { loadTickets, saveTicket } from "./ticket-db";

/**
 * This device's tickets per network, loaded once from the encrypted store and kept in memory.
 * `null` while loading (the page shows its skeleton); `"unavailable"` when storage is blocked.
 */
type State = Ticket[] | null | "unavailable";

const states = new Map<Network, State>();
const listeners = new Set<() => void>();
const loading = new Set<Network>();
const EMPTY: State = null;

function notify() {
  for (const listener of listeners) listener();
}

function ensure(network: Network) {
  if (states.has(network) || loading.has(network) || typeof indexedDB === "undefined") return;
  loading.add(network);
  loadTickets(network)
    .then((tickets) => states.set(network, tickets))
    .catch(() => states.set(network, "unavailable"))
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

/** Re-reads from storage (after an import or Forget this device). */
export function reloadTickets() {
  states.clear();
  notify();
}
