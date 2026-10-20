/**
 * Sign in with X (plan §0 R7): optional, and the last way to name a device on the boards. The handle becomes the
 * device key's nickname; the arcade keeps the handle and a salted hash of the X id, never a token.
 */

/** `GET /arcade/v1/x/config`: whether it's on here, and the client id and callback the browser sends to X. */
export type XConfig = { clientId: string; redirectUri: string } | { clientId: null };

/** `POST /arcade/v1/x/link`: the code X returned and the PKCE verifier, signed by the arcade key. */
export interface XLinkRequest {
  action: "x-link";
  player: string;
  code: string;
  verifier: string;
  at: number;
}

export interface XLinked {
  nickname: string;
}

/** X's authorize endpoint and the scopes `GET /2/users/me` needs (docs.x.com). */
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_SCOPES = "tweet.read users.read";
