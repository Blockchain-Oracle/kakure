"use client";

import { useSyncExternalStore } from "react";

/** The three market tabs (surfaces.md Markets): crypto, US stocks, and Zcash itself (ZEC and chain events). */
export const CATEGORIES = ["crypto", "stocks", "zcash"] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_CATEGORY: Category = "crypto";

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * The selected tab, shared by the tabs, the rail and the dock. On /markets it lives in the URL fragment
 * (`/markets#stocks`), which browsers never send to the host.
 */
let current: Category | null = null;
const listeners = new Set<() => void>();

function read(): Category {
  if (current === null) {
    const hash = typeof location === "undefined" ? "" : location.hash.slice(1);
    current = isCategory(hash) ? hash : DEFAULT_CATEGORY;
  }
  return current;
}

export function setCategory(next: Category, { writeHash = true }: { writeHash?: boolean } = {}) {
  if (writeHash && location.hash.slice(1) !== next) {
    history.replaceState(history.state, "", `#${next}`);
  }
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onHash = () => {
    const hash = location.hash.slice(1);
    if (isCategory(hash)) setCategory(hash, { writeHash: false });
  };
  window.addEventListener("hashchange", onHash);
  window.addEventListener("popstate", onHash);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("popstate", onHash);
  };
}

export function useCategory(): Category {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_CATEGORY);
}
