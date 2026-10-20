"use client";

import {
  ARCADE_PATH,
  type ArcadeGame,
  type Board,
  type BoardPeriod,
  powMeets,
  type RunIssued,
  type ScoreAccepted,
  type ScoreClaim,
  type Standing,
  type Tape,
} from "@kakure/arcade";
import { POW_YIELD_EVERY } from "./constants";
import { playerKey, signAsPlayer } from "./device-key";

/**
 * The arcade API from the browser (plan §0 R4): `/arcade/v1/` on the site's own origin, which the site worker forwards
 * to the arcade service as a fresh request carrying only the method, path and body, so the service never sees an IP or
 * a header of yours. Reads are public boards; writes are signed by this device's key.
 */
export class ArcadeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ARCADE_PATH}${path}`, {
    method,
    cache: "no-store",
    credentials: "omit",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || answer === null) {
    throw new ArcadeError(answer?.error ?? `the arcade answered ${response.status}`, response.status);
  }
  return answer;
}

export const readBoard = (game: ArcadeGame, period: BoardPeriod, limit?: number): Promise<Board> =>
  call("GET", `/board/${game}/${period}${limit ? `?limit=${limit}` : ""}`);

export const readStanding = (game: ArcadeGame): Promise<Standing> => call("GET", `/me/${game}/${playerKey()}`);

/** A seed for the next run and the signed-prints tape it rides (null: the seed draws its own line). */
export const issueRun = (game: ArcadeGame): Promise<RunIssued> => call("POST", `/run/${game}`);

/** A tape for the cabinets' attract loops: the same for everyone for five minutes, never rankable. */
export const readAttractTape = async (): Promise<Tape | null> =>
  (await call<{ tape: Tape | null }>("GET", "/tape")).tape;

/** The claim's work (about a quarter of a million hashes), a slice at a time so the page keeps drawing. */
async function solve(nickname: string, player: string): Promise<number> {
  for (let nonce = 0; ; nonce += 1) {
    if (powMeets({ player, nickname }, nonce)) return nonce;
    if (nonce % POW_YIELD_EVERY === 0) await new Promise((resolve) => setTimeout(resolve));
  }
}

/** Claims a nickname for this device: the work done here, the claim signed by the device key. */
export async function claimNickname(nickname: string): Promise<string> {
  const player = playerKey();
  const nonce = await solve(nickname, player);
  const answer = await call<{ nickname: string }>("POST", "/player", signAsPlayer({ player, nickname, nonce }));
  return answer.nickname;
}

/** Posts a finished run, signed; the service replays it before it ranks. */
export function postScore(claim: Omit<ScoreClaim, "player">): Promise<ScoreAccepted> {
  return call("POST", "/score", signAsPlayer({ ...claim, player: playerKey() }));
}
