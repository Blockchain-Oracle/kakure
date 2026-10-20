import { DUEL_DECK_SIZE, SIGNED_SKEW_SEC } from "@kakure/arcade";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import type { Verdict } from "./handlers";

/**
 * The Duel's signed requests: each names the call it's for (`action`) and its time (`at`), and is signed by the key it
 * names, so it can't be replayed later or sent as another call. Checked cheapest first: the shape and the action, the
 * signature, then the time.
 */
const MS = 1000;
const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_COMMIT = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32,128}$/;
export const nowSec = () => Math.floor(Date.now() / MS);
export const BAD_REQUEST = 400;
export const UNAUTHORIZED = 401;
export const NOT_FOUND = 404;
export const CONFLICT = 409;
export const UNPROCESSABLE = 422;
export const UNAVAILABLE = 503;

export const refuse = <T>(status: number, error: string): Verdict<T> => ({ ok: false, status, error });

const signedFields = { player: z.string().regex(HEX_KEY), at: z.number().int(), sig: z.string() };
export const keySchema = z.object({ action: z.enum(["state", "history", "queue", "leave"]), ...signedFields });
export const commitSchema = z.object({
  action: z.literal("commit"),
  matchId: z.string(),
  commitment: z.string().regex(HEX_COMMIT),
  ...signedFields,
});
export const revealSchema = z.object({
  action: z.literal("reveal"),
  matchId: z.string(),
  picks: z.array(z.enum(["up", "down"])).length(DUEL_DECK_SIZE),
  salt: z.string().regex(SALT),
  ...signedFields,
});

/** Parses a signed Duel request for `action`: the shape, the call it was signed for, the key's signature, the time. */
export function signedRequest<T extends { action: string; player: string; at: number }>(
  schema: z.ZodType<T>,
  raw: unknown,
  action: T["action"],
): { ok: true; req: T } | { ok: false; status: number; error: string } {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data.action !== action) return { ok: false, status: BAD_REQUEST, error: "bad request" };
  const req = parsed.data;
  if (!verifyDocument(req as unknown as Record<string, unknown>, hexToBytes(req.player))) {
    return { ok: false, status: UNAUTHORIZED, error: "the request isn't signed by its key" };
  }
  if (Math.abs(nowSec() - req.at) > SIGNED_SKEW_SEC) {
    return { ok: false, status: BAD_REQUEST, error: "the request is stale; try again" };
  }
  return { ok: true, req };
}
