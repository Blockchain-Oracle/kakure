"use client";

import { useSyncExternalStore } from "react";

/** Which shell overlay is open: More, the search palette or the shortcuts list (one at a time). */
export type Overlay = "more" | "search" | "keys" | null;

let overlay: Overlay = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setOverlay(next: Overlay) {
  if (next === overlay) return;
  overlay = next;
  for (const listener of listeners) listener();
}

export function useOverlay(): Overlay {
  return useSyncExternalStore(
    subscribe,
    () => overlay,
    () => null,
  );
}

/**
 * True while the user is typing or a dialog holds focus, so single-key shortcuts stay out of the way
 * (Mitoshi Rail.tsx `shortcutBlocked`).
 */
export function shortcutBlocked(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  ) {
    return true;
  }
  return document.querySelector("dialog[open]") !== null;
}
