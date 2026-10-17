import type { Network } from "@kakure/domain";
import { useEffect, useSyncExternalStore } from "react";
import { type AppTicket, loadTickets, saveTicket } from "./ticket-db";

/**
 * Tickets per network, read from the encrypted database once and kept in memory; every save updates the cache
 * and notifies screens. `null` = still loading, "unavailable" = the database could not be opened.
 */
type Loaded = AppTicket[] | null | "unavailable";

const cache = new Map<Network, Loaded>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

async function load(network: Network): Promise<void> {
  try {
    cache.set(network, await loadTickets(network));
  } catch {
    cache.set(network, "unavailable");
  }
  notify();
}

export function useTickets(network: Network): Loaded {
  useEffect(() => {
    if (!cache.has(network)) {
      cache.set(network, null);
      void load(network);
    }
  }, [network]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cache.get(network) ?? null,
    () => null,
  );
}

export function ticketsNow(network: Network): AppTicket[] {
  const loaded = cache.get(network);
  return Array.isArray(loaded) ? loaded : [];
}

/** Saves (insert or replace) and updates every screen. Throws if the database is unavailable. */
export async function putTicket(ticket: AppTicket): Promise<void> {
  await saveTicket(ticket);
  const current = cache.get(ticket.network);
  const list = Array.isArray(current) ? current.filter((existing) => existing.hash !== ticket.hash) : [];
  cache.set(
    ticket.network,
    [ticket, ...list].sort((left, right) => right.createdAt - left.createdAt),
  );
  notify();
}

/** Applies a change to one ticket, by hash, if it exists. */
export async function updateTicket(
  network: Network,
  hash: string,
  change: (ticket: AppTicket) => AppTicket,
): Promise<void> {
  const ticket = ticketsNow(network).find((candidate) => candidate.hash === hash);
  if (ticket) await putTicket(change(ticket));
}

/** Forget this device / import: drop the in-memory copies so the next read reloads. */
export function resetTickets(): void {
  cache.clear();
  notify();
}
