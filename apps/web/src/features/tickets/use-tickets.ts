"use client";

import type { Network } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { useSyncExternalStore } from "react";
import {
  type LockState,
  loadTickets,
  lockNow,
  lockState,
  removeLock,
  saveTicket,
  setLock,
  TicketsLockedError,
  unlock,
} from "./ticket-db";

/**
 * This device's tickets per network, loaded once from the encrypted store and kept in memory.
 * `null` while loading (the page shows its skeleton); `"unavailable"` when storage is blocked; `"locked"` when the
 * optional passphrase lock is on and this tab hasn't unlocked it.
 */
type State = Ticket[] | null | "unavailable" | "locked";

const states = new Map<Network, State>();
const listeners = new Set<() => void>();
const loading = new Set<Network>();
const EMPTY: State = null;
let lock: LockState | null = null;
let lockReading = false;

function notify() {
  for (const listener of listeners) listener();
}

function ensure(network: Network) {
  if (states.has(network) || loading.has(network) || typeof indexedDB === "undefined") return;
  loading.add(network);
  loadTickets(network)
    .then((tickets) => states.set(network, tickets))
    .catch((error: unknown) => states.set(network, error instanceof TicketsLockedError ? "locked" : "unavailable"))
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

function refreshLock() {
  if (lockReading) return;
  lockReading = true;
  lockState()
    .then((next) => {
      lock = next;
    })
    .catch(() => {
      lock = "off";
    })
    .finally(() => {
      lockReading = false;
      notify();
    });
}

/** The lock's state for Settings (`null` until read). */
export function useLockState(): LockState | null {
  if (lock === null && typeof indexedDB !== "undefined") refreshLock();
  return useSyncExternalStore(
    subscribe,
    () => lock,
    () => null,
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

/** Re-reads from storage (after an import, a lock change or Forget this device). */
export function reloadTickets() {
  states.clear();
  lock = null;
  notify();
}

export async function unlockTickets(passphrase: string): Promise<boolean> {
  const ok = await unlock(passphrase);
  if (ok) reloadTickets();
  return ok;
}

export async function lockTickets(passphrase: string): Promise<void> {
  await setLock(passphrase);
  reloadTickets();
}

export async function removeTicketLock(): Promise<void> {
  await removeLock();
  reloadTickets();
}

export function lockTicketsNow() {
  lockNow();
  reloadTickets();
}
