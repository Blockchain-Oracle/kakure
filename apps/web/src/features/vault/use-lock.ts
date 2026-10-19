"use client";

import { useSyncExternalStore } from "react";
import { type LockState, lockState, onVaultReset } from "./vault-db";

/** The vault lock's state for Settings and the unlock prompts (`null` until read), re-read after every change. */
let lock: LockState | null = null;
let reading = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

onVaultReset(() => {
  lock = null;
  notify();
});

function refresh() {
  if (reading) return;
  reading = true;
  lockState()
    .then((next) => {
      lock = next;
    })
    .catch(() => {
      lock = "off";
    })
    .finally(() => {
      reading = false;
      notify();
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLockState(): LockState | null {
  if (lock === null && typeof indexedDB !== "undefined") refresh();
  return useSyncExternalStore(
    subscribe,
    () => lock,
    () => null,
  );
}
