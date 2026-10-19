"use client";

import type { Network } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { STORAGE_KEYS } from "@/constants";
import { syncThemeColor } from "@/features/theme/theme-store";
import { safeStorage } from "@/lib/storage";

/**
 * The network choice: one store read by React (useSyncExternalStore) and by plain code (getNetwork), persisted on
 * this device only. Testnet is the default, so nobody lands on real money without the slide. <html data-network> is
 * set before first paint by the init script, so CSS (the world's tint, the toggle) never flashes.
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

/**
 * Switches the world with Mitoshi's flood (environment.css:19-25, environment.ts): a view transition whose new state
 * is revealed by a circle spreading from the control that made the change, 520 ms on cubic-bezier(.65, 0, .35, 1)
 * (`--duration-network-flood`, `--ease-flood`, run by `html[data-flooding]` in globals.css). The testnet world's
 * canvas and rail are tinted vermilion by the tokens, so the circle carries the tint in or out. Reduced motion, or a
 * browser without view transitions, switches at once; the phone's browser bar follows the new ground.
 */
export function switchNetwork(next: Network, origin?: { x: number; y: number }) {
  if (next === readNetwork()) return;
  fire("toggle");
  const root = document.documentElement;
  const paint = () => {
    flushSync(() => commit(next));
    syncThemeColor();
  };
  const reduced = root.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    paint();
    return;
  }
  root.style.setProperty("--flood-x", `${Math.round(origin?.x ?? window.innerWidth / 2)}px`);
  root.style.setProperty("--flood-y", `${Math.round(origin?.y ?? 0)}px`);
  root.dataset.flooding = "";
  void document.startViewTransition(paint).finished.finally(() => {
    delete root.dataset.flooding;
  });
}

/** The centre of an element on screen: where a flood starts. */
export function centreOf(element: Element | null): { x: number; y: number } | undefined {
  const rect = element?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
}
