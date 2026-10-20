import { createHmac } from "node:crypto";
import { NICKNAME_PATTERN, SIGNED_SKEW_SEC, type XConfig, type XLinked } from "@kakure/arcade";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { FETCH_TIMEOUT_MS, X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI } from "./constants";
import type { Verdict } from "./handlers";
import type { ArcadeStore } from "./store";
import { BAD_REQUEST, CONFLICT, nowSec, refuse, UNAUTHORIZED, UNAVAILABLE, UNPROCESSABLE } from "./verdicts";

/**
 * Sign in with X (plan §0 R7; X's OAuth 2.0 authorization code flow with PKCE, docs.x.com "OAuth 2.0 Authorization
 * Code Flow with PKCE"). The browser makes the PKCE verifier and goes to X; X sends it back to the site's `/x` page
 * with a code, valid 30 seconds; the browser hands the code and verifier to this service, signed by its arcade key.
 * The service exchanges them for a token (`POST https://api.x.com/2/oauth2/token`), reads the handle
 * (`GET https://api.x.com/2/users/me`, scopes `tweet.read users.read`), revokes the token at once
 * (`POST https://api.x.com/2/oauth2/revoke`) and keeps only the handle and a salted hash of the X id. The handle
 * becomes the key's board name. Off until the operator sets `X_CLIENT_ID` and `X_REDIRECT_URI`.
 */
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
const ME_URL = "https://api.x.com/2/users/me";
const HEX_KEY = /^[0-9a-f]{64}$/;
/** RFC 7636 §4.1: a verifier is 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** An authorization code longer than this is no code of X's. */
const CODE_MAX_CHARS = 1_024;

const linkSchema = z.object({
  action: z.literal("x-link"),
  player: z.string().regex(HEX_KEY),
  code: z.string().min(1).max(CODE_MAX_CHARS),
  verifier: z.string().regex(VERIFIER),
  at: z.number().int(),
  sig: z.string(),
});
const meSchema = z.object({ data: z.object({ id: z.string().min(1), username: z.string().min(1) }) });

export function xConfig(): XConfig {
  return X_CLIENT_ID && X_REDIRECT_URI ? { clientId: X_CLIENT_ID, redirectUri: X_REDIRECT_URI } : { clientId: null };
}

/** X's client authentication: Basic with the secret for a confidential client, the id in the body for a public one. */
function clientAuth(body: URLSearchParams): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (X_CLIENT_SECRET) {
    headers.authorization = `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64")}`;
  } else {
    body.set("client_id", X_CLIENT_ID ?? "");
  }
  return headers;
}

async function post(url: string, fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(fields);
  const headers = clientAuth(body);
  return fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/** The X account behind a code: its id and handle, the token revoked before this returns. */
async function accountOf(code: string, verifier: string): Promise<{ id: string; handle: string } | null> {
  const exchanged = await post(TOKEN_URL, {
    code,
    grant_type: "authorization_code",
    redirect_uri: X_REDIRECT_URI ?? "",
    code_verifier: verifier,
  });
  if (!exchanged.ok) return null;
  const token = ((await exchanged.json()) as { access_token?: unknown }).access_token;
  if (typeof token !== "string") return null;
  try {
    const me = await fetch(ME_URL, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const parsed = meSchema.safeParse(me.ok ? await me.json() : null);
    return parsed.success ? { id: parsed.data.data.id, handle: parsed.data.data.username } : null;
  } finally {
    await post(REVOKE_URL, { token, token_type_hint: "access_token" }).catch(() => undefined);
  }
}

/** `POST /x/link`: binds the signed-in X handle to this device key as its board name. */
export async function linkX(store: ArcadeStore, raw: unknown): Promise<Verdict<XLinked>> {
  if (!X_CLIENT_ID || !X_REDIRECT_URI) return refuse(UNAVAILABLE, "Sign in with X isn't set up here");
  const parsed = linkSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a sign-in");
  const req = parsed.data;
  if (!verifyDocument(req as unknown as Record<string, unknown>, hexToBytes(req.player))) {
    return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  }
  if (Math.abs(nowSec() - req.at) > SIGNED_SKEW_SEC) return refuse(BAD_REQUEST, "the request is stale; try again");
  const account = await accountOf(req.code, req.verifier).catch(() => null);
  if (!account) return refuse(UNAUTHORIZED, "X didn't confirm the sign-in; try again");
  if (!NICKNAME_PATTERN.test(account.handle)) {
    return refuse(UNPROCESSABLE, `@${account.handle} can't be a board name (3–16 letters, digits, _ or -)`);
  }
  const idHash = createHmac("sha256", store.x.salt()).update(account.id).digest("hex");
  const holder = store.x.playerOf(idHash);
  if (holder !== null && holder !== req.player) {
    return refuse(CONFLICT, `@${account.handle} already names another device`);
  }
  if (!store.claim(req.player, account.handle)) {
    return refuse(CONFLICT, `${account.handle} is already someone's nickname on the boards`);
  }
  store.x.link(req.player, idHash, account.handle);
  return { ok: true, body: { nickname: account.handle } };
}
