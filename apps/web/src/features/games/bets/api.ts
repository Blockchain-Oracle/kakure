"use client";

import {
  ARCADE_PATH,
  type BetsBoard,
  type BetsPeriod,
  type Profile,
  type ReceiptAccepted,
  type ReceiptToken,
} from "@kakure/arcade";
import { ArcadeError } from "../player/api";
import { MS_PER_SEC } from "../player/constants";
import { playerKey, signAsPlayer } from "../player/device-key";

/**
 * Bets and profiles from the browser (plan §0 R7 under v2), on the arcade's door like the rest: the site worker forwards
 * method, path and body only. Publishing carries only the operator's receipt token (right or wrong, for this key),
 * which the device got over the sealed path: nothing about the trade comes this way.
 */
const now = () => Math.floor(Date.now() / MS_PER_SEC);

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

export const readBetsBoard = (period: BetsPeriod): Promise<BetsBoard> => call("GET", `/bets/${period}`);

/** A nickname's public play; the name goes in the body, never a URL. */
export const readProfile = (nickname: string): Promise<Profile> => call("POST", "/profile", { nickname });

export function publishToken(token: ReceiptToken): Promise<ReceiptAccepted> {
  return call(
    "POST",
    "/receipt",
    signAsPlayer({ action: "publish", player: playerKey(), token: { ...token }, at: now() }),
  );
}

export function retractReceipt(receipt: string): Promise<{ receipt: string }> {
  return call("POST", "/receipt/retract", signAsPlayer({ action: "retract", player: playerKey(), receipt, at: now() }));
}
