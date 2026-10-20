"use client";

import {
  ARCADE_PATH,
  DUEL_PATH,
  type DuelBoardRow,
  type DuelHistoryRow,
  type DuelKeyRequest,
  type DuelMatchView,
  type DuelPick,
  type DuelRecent,
  type DuelState,
  duelCommitment,
} from "@kakure/arcade";
import { ArcadeError } from "../player/api";
import { playerKey, signAsPlayer } from "../player/device-key";

/**
 * The Duel from the browser (plan §0 R5), on the arcade's door: the site worker forwards each call with nothing of
 * yours attached. Every call that names this device's key is a POST signed by it, with the call it's for and the
 * time, so it can't be replayed later or as another call, and the key never sits in a URL. Picks leave the device
 * only as a commitment until both players are locked in.
 */
const MS = 1000;
const now = () => Math.floor(Date.now() / MS);
const signedKey = (action: DuelKeyRequest["action"]) => signAsPlayer({ action, player: playerKey(), at: now() });

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ARCADE_PATH}${DUEL_PATH}${path}`, {
    method,
    cache: "no-store",
    credentials: "omit",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || answer === null) {
    throw new ArcadeError(answer?.error ?? `the duel answered ${response.status}`, response.status);
  }
  return answer;
}

/** Where this key stands; while it waits, this poll is what keeps its place. */
export const readDuelState = (): Promise<DuelState> => call("POST", "/state", signedKey("state"));
export const readMatch = (id: string): Promise<DuelMatchView> => call("GET", `/match/${id}`);
export const readDuelBoard = (): Promise<DuelBoardRow[]> => call("GET", "/board");
export const readDuelRecent = (): Promise<DuelRecent[]> => call("GET", "/recent");
export const readDuelHistory = (): Promise<DuelHistoryRow[]> => call("POST", "/history", signedKey("history"));

export const joinQueue = (): Promise<DuelState> => call("POST", "/queue", signedKey("queue"));
export const leaveQueue = (): Promise<DuelState> => call("POST", "/leave", signedKey("leave"));

export function commitPicks(matchId: string, picks: readonly DuelPick[], salt: string): Promise<DuelMatchView> {
  const player = playerKey();
  const commitment = duelCommitment({ matchId, player, picks, salt });
  return call("POST", "/commit", signAsPlayer({ action: "commit", player, matchId, commitment, at: now() }));
}

export function revealPicks(matchId: string, picks: DuelPick[], salt: string): Promise<DuelMatchView> {
  return call(
    "POST",
    "/reveal",
    signAsPlayer({ action: "reveal", player: playerKey(), matchId, picks, salt, at: now() }),
  );
}
