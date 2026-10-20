import { SIGNED_SKEW_SEC } from "@kakure/arcade";

/**
 * One memory of the signed requests that change something (a nickname claim, a Duel move, a Bets publication or
 * retraction, an X sign-in), so a copy sent again while its time is still good is refused. Callers check it last,
 * after the signature, the time and what the request is allowed to touch, so only requests that would have done
 * something land here. It's bounded: past `MAX_REMEMBERED` the oldest go first, and expired entries are dropped
 * every `PRUNE_EVERY_SEC`, never by scanning on each request.
 */
const REMEMBER_SEC = 2 * SIGNED_SKEW_SEC;
const MAX_REMEMBERED = 100_000;
const PRUNE_EVERY_SEC = 30;

const seen = new Map<string, number>();
let nextPrune = 0;

/** True the first time a request's signature is seen within its window. */
export function firstUse(sig: string, now: number): boolean {
  if (now >= nextPrune) {
    for (const [old, until] of seen) if (until < now) seen.delete(old);
    nextPrune = now + PRUNE_EVERY_SEC;
  }
  if (seen.has(sig)) return false;
  seen.set(sig, now + REMEMBER_SEC);
  if (seen.size > MAX_REMEMBERED) {
    const oldest = seen.keys().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}
