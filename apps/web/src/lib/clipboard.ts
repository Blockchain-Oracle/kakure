"use client";

/**
 * Copies a secret (a bet link, a provable receipt) and clears the clipboard a minute later (O12), best effort:
 * browsers only let a page write the clipboard while it's focused, so if the tab is in the background at that
 * moment it clears on the next focus instead. Pages can't read the clipboard back without a prompt, so this can't
 * check whether you copied something else since; it clears either way.
 */
const CLEAR_AFTER_MS = 60_000;

let pending: ReturnType<typeof setTimeout> | null = null;

function clear() {
  if (document.hasFocus()) {
    void navigator.clipboard.writeText("").catch(() => undefined);
    return;
  }
  window.addEventListener("focus", () => void navigator.clipboard.writeText("").catch(() => undefined), {
    once: true,
  });
}

export async function copySecret(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    clear();
  }, CLEAR_AFTER_MS);
}
