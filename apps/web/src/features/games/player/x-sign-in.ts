"use client";

import { ARCADE_PATH, X_AUTHORIZE_URL, X_SCOPES, type XConfig, type XLinked, type XLinkRequest } from "@kakure/arcade";
import { toBase64Url } from "@kakure/domain";
import { ArcadeError } from "./api";
import { MS_PER_SEC } from "./constants";
import { playerKey, signAsPlayer } from "./device-key";
import { setNickname } from "./player-store";

/**
 * Sign in with X from the browser (plan §0 R7; X's OAuth 2.0 authorization code flow with PKCE). This tab makes the
 * verifier and a state, keeps them in session storage (this tab only), and goes to X; X sends the tab back to `/x`
 * with a code, which this device signs over to the arcade with the verifier. The arcade does the rest and keeps no
 * token. Nothing here is sent anywhere else.
 */
const PENDING_KEY = "kakure.xSignIn";
const VERIFIER_BYTES = 32;
const STATE_BYTES = 16;

interface Pending {
  verifier: string;
  state: string;
  player: string;
}

const random = (n: number) => toBase64Url(crypto.getRandomValues(new Uint8Array(n)));

export async function readXConfig(): Promise<XConfig> {
  const response = await fetch(`${ARCADE_PATH}/x/config`, { cache: "no-store", credentials: "omit" });
  if (!response.ok) return { clientId: null };
  return (await response.json()) as XConfig;
}

/** Starts the sign-in: the PKCE pair and state for this tab, then X's consent page. */
export async function startXSignIn(config: Extract<XConfig, { clientId: string }>): Promise<void> {
  const pending: Pending = { verifier: random(VERIFIER_BYTES), state: random(STATE_BYTES), player: playerKey() };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.verifier));
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = new URL(X_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: X_SCOPES,
    state: pending.state,
    code_challenge: toBase64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  }).toString();
  location.assign(url.toString());
}

export type XFinish = { kind: "linked"; nickname: string } | { kind: "denied" } | { kind: "stale" };

/** Finishes the sign-in from X's redirect: the state must be this tab's, and the code goes to the arcade at once. */
export async function finishXSignIn(search: string): Promise<XFinish> {
  const params = new URLSearchParams(search);
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  const pending = raw ? (JSON.parse(raw) as Pending) : null;
  if (params.get("error")) return { kind: "denied" };
  const code = params.get("code");
  if (!pending || !code || params.get("state") !== pending.state || pending.player !== playerKey()) {
    return { kind: "stale" };
  }
  const request: XLinkRequest = {
    action: "x-link",
    player: pending.player,
    code,
    verifier: pending.verifier,
    at: Math.floor(Date.now() / MS_PER_SEC),
  };
  const response = await fetch(`${ARCADE_PATH}/x/link`, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signAsPlayer({ ...request })),
  });
  const answer = (await response.json().catch(() => null)) as (XLinked & { error?: string }) | null;
  if (!response.ok || !answer)
    throw new ArcadeError(answer?.error ?? `the arcade answered ${response.status}`, response.status);
  setNickname(answer.nickname);
  return { kind: "linked", nickname: answer.nickname };
}
