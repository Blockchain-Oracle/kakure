"use client";

import { useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/storage";
import { gameEntry, gameIdFromPath } from "./catalog";
import { gameKey } from "./keys";

/**
 * The last game a player opened (Pips's `lastGame`, Mitoshi `last-game.ts`): the rail writes it as a route is visited,
 * the hall offers it first. Read after hydration only (the server has no storage, so the plate appears afterwards).
 */
const KEY = gameKey("last");
const noop = () => () => undefined;

export function rememberGame(pathname: string | null): void {
  const id = gameIdFromPath(pathname);
  if (id && gameEntry(id).open) safeStorage.setItem(KEY, id);
}

let snapshot: { key: string | null; value: { href: string; name: string } | null } = { key: null, value: null };

function read(): { href: string; name: string } | null {
  const key = safeStorage.getItem(KEY);
  if (snapshot.key !== key) {
    const id = gameIdFromPath(`/games/${key ?? ""}`);
    const entry = id ? gameEntry(id) : null;
    snapshot = { key, value: entry?.open ? { href: entry.href, name: entry.name } : null };
  }
  return snapshot.value;
}

export function useLastGame(): { href: string; name: string } | null {
  return useSyncExternalStore(noop, read, () => null);
}
