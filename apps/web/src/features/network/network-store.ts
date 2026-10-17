"use client";

import type { Network } from "@kakure/domain";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { STORAGE_KEYS } from "@/constants";
import { safeStorage } from "@/lib/storage";

/**
 * The network choice: one store read by React (useSyncExternalStore) and by plain code (getNetwork), persisted on
 * this device only (Senryo's pattern, senryo.md §5.3). Testnet is the default, so nobody lands on real money
 * without the slide. <html data-network> is set before first paint by the init script, so CSS never flashes.
 */
export const DEFAULT_NETWORK: Network = "testnet";

const listeners = new Set<() => void>();

function readNetwork(): Network {
  if (typeof document === "undefined") return DEFAULT_NETWORK;
  return document.documentElement.dataset.network === "mainnet" ? "mainnet" : "testnet";
}

export function getNetwork(): Network {
  return readNetwork();
}

function commit(next: Network) {
  document.documentElement.dataset.network = next;
  safeStorage.setItem(STORAGE_KEYS.network, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNetwork(): Network {
  return useSyncExternalStore(subscribe, readNetwork, () => DEFAULT_NETWORK);
}

function cssMs(name: string): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/**
 * Switches the network with the flood (senryo.md §5.4, owarine.md §4, refero lock §2): a view transition whose
 * new state is revealed by a circle spreading from the toggle over 520 ms. Inside the circle the whole shell is
 * tinted with the new network's surface (`data-flood`), then it settles back to the neutral stage. Reduced motion,
 * or a browser without view transitions, switches at once. Timing comes from the token CSS, the single source.
 */
export function switchNetwork(next: Network, origin?: { x: number; y: number }) {
  if (next === readNetwork()) return;
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    commit(next);
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.dataset.vt = "flood";
  const transition = document.startViewTransition(() => {
    flushSync(() => commit(next));
    root.dataset.flood = next;
  });
  void transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      {
        duration: cssMs("--duration-network-flood"),
        easing: getComputedStyle(root).getPropertyValue("--ease-flood").trim(),
        pseudoElement: "::view-transition-new(root)",
      },
    );
  });
  void transition.finished.finally(() => {
    delete root.dataset.vt;
    // Settle back into the neutral stage (CSS transitions the ground over --duration-flood-settle).
    delete root.dataset.flood;
  });
}
