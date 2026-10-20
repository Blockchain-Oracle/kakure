import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * Lucky (plan §0 R5; Mitoshi core `games/lucky.ts` and `commitment.ts`, from Masayume), drawn on the device: no request
 * leaves the browser until the player pulls the lever and places the one real trade, so nobody learns the draw before
 * it's a trade. The draw is HMAC-SHA256 keyed by the signed minute bundle's hash (public, and unknowable before the
 * operator publishes it) over the policy, the candidate Windows' hash and a seed made on the device at the spin, so the
 * browser can show its working and recompute it. Mitoshi drew on a server with a commitment; here the server would
 * learn the bet before it lands, so the draw moved to the device.
 */
export const LUCKY_POLICY_VERSION = 1;
/** The reach ladder, in whole multiples (Masayume's 2 / 3 / 5 / 10 / 25). */
const REACH_2 = 2;
const REACH_3 = 3;
const REACH_5 = 5;
const REACH_10 = 10;
const REACH_25 = 25;
export const LUCKY_MULTIPLIERS: readonly number[] = [REACH_2, REACH_3, REACH_5, REACH_10, REACH_25];
/** A Window needs this long before its close so the lever can be pulled in time (entry ends 30 s before). */
export const LUCKY_MIN_HEADROOM_SEC = 90;
/** Past this the live multiple has moved far enough from the dealt one that the card must say so (10 %). */
export const LUCKY_DRIFT_BPS = 1_000;

const BPS = 10_000;
const BYTE_VALUES = 256;
const SEED_BYTES = 32;

export type LuckySide = "up" | "down";

export interface LuckyDraw {
  asset: string;
  side: LuckySide;
  multiplier: number;
}

/** A Window as the draw sees it. */
export interface LuckyCandidate {
  id: string;
  asset: string;
  intervalSec: number;
  expirySec: number;
  trading: boolean;
}

/** The candidate set's fingerprint: the policy and the Window ids, sorted, so the same set always hashes the same. */
export function luckyCandidateHash(ids: readonly string[], policyVersion = LUCKY_POLICY_VERSION): string {
  const sorted = [...new Set(ids)].sort();
  return bytesToHex(sha256(new TextEncoder().encode(`kakure-lucky:${policyVersion}:${sorted.join(",")}`)));
}

/** What the draw's HMAC signs: the policy, the candidate hash and the device's seed. */
export function luckyMessage(input: { policyVersion: number; candidateHash: string; seed: string }): Uint8Array {
  return new TextEncoder().encode(`kakure-lucky:${input.policyVersion}:${input.candidateHash}:${input.seed}`);
}

/** One index in `[0, n)` from a byte stream without modulo bias: bytes at or past the last whole multiple are skipped. */
export function unbiasedIndex(bytes: Uint8Array, cursor: number, n: number): { index: number; cursor: number } {
  if (n <= 0) throw new Error("unbiasedIndex needs a positive range");
  if (n === 1) return { index: 0, cursor };
  const limit = BYTE_VALUES - (BYTE_VALUES % n);
  for (let at = cursor; at < bytes.length; at += 1) {
    const byte = bytes[at] as number;
    if (byte < limit) return { index: byte % n, cursor: at + 1 };
  }
  throw new Error("the draw ran out of entropy before a fair index");
}

/** The digest as an asset, a side and a reach, each read without bias from the bytes in turn. */
export function mapLuckyDraw(
  digest: Uint8Array,
  assets: readonly string[],
  multipliers = LUCKY_MULTIPLIERS,
): LuckyDraw {
  if (assets.length === 0 || multipliers.length === 0) throw new Error("a draw needs assets and multipliers");
  const asset = unbiasedIndex(digest, 0, assets.length);
  const side = unbiasedIndex(digest, asset.cursor, 2);
  const reach = unbiasedIndex(digest, side.cursor, multipliers.length);
  return {
    asset: assets[asset.index] as string,
    side: side.index === 0 ? "up" : "down",
    multiplier: multipliers[reach.index] as number,
  };
}

/** A fresh seed for one spin, from the device's own randomness. */
export function luckySeed(): string {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(SEED_BYTES)));
}

/** The whole draw from its inputs: keyed by the bundle's hash, over the message. Anyone holding them gets the same. */
export function drawLucky(input: {
  bundleHash: string;
  seed: string;
  candidates: readonly LuckyCandidate[];
  policyVersion?: number;
}): { draw: LuckyDraw; candidateHash: string; assets: string[] } {
  const policyVersion = input.policyVersion ?? LUCKY_POLICY_VERSION;
  const assets = [...new Set(input.candidates.map((c) => c.asset))].sort();
  const candidateHash = luckyCandidateHash(
    input.candidates.map((c) => c.id),
    policyVersion,
  );
  const digest = hmac(
    sha256,
    hexToBytes(input.bundleHash),
    luckyMessage({ policyVersion, candidateHash, seed: input.seed }),
  );
  return { draw: mapLuckyDraw(digest, assets), candidateHash, assets };
}

/** The Windows a draw may land on: trading now, with real life left before the close. */
export function eligibleLuckyWindows(candidates: readonly LuckyCandidate[], nowSec: number): LuckyCandidate[] {
  return candidates
    .filter((c) => c.trading && c.expirySec - nowSec >= LUCKY_MIN_HEADROOM_SEC)
    .sort((a, b) => a.expirySec - b.expirySec || a.id.localeCompare(b.id));
}

/** The price (in 1/10,000) at which a side pays the target multiple. */
export const targetAskE4 = (multiplier: number): number => Math.round(BPS / multiplier);

/** The quote whose ask sits closest to 1 / M; ties go to the soonest close, so nobody waits longer than the reach needs. */
export function chooseLuckyWindow<T extends { askE4: number; expirySec: number }>(
  quotes: readonly T[],
  multiplier: number,
): T | null {
  const target = targetAskE4(multiplier);
  let best: T | null = null;
  for (const quote of quotes) {
    if (!best) {
      best = quote;
      continue;
    }
    const distance = Math.abs(quote.askE4 - target);
    const bestDistance = Math.abs(best.askE4 - target);
    if (distance < bestDistance || (distance === bestDistance && quote.expirySec < best.expirySec)) best = quote;
  }
  return best;
}

/** True when the live ask has moved more than 10 % from the dealt one. */
export const luckyDrifted = (dealtE4: number, liveE4: number): boolean =>
  Math.abs(liveE4 - dealtE4) * BPS > dealtE4 * LUCKY_DRIFT_BPS;

/** A draw's outcome once it's a trade: still riding, or what its close decided. */
export type LuckyResult = "riding" | "won" | "lost" | "refund" | "closed";

/** Wins in a row from the newest decided draw; a refund decided nothing and a close isn't a verdict. */
export function luckyStreak(newestFirst: readonly { result: LuckyResult }[]): number {
  let streak = 0;
  for (const row of newestFirst) {
    if (row.result === "won") streak += 1;
    else if (row.result === "lost") break;
  }
  return streak;
}

/** The longest run of wins, by the same rule, over draws oldest first. */
export function luckyBestStreak(oldestFirst: readonly { result: LuckyResult }[]): number {
  let best = 0;
  let run = 0;
  for (const row of oldestFirst) {
    if (row.result === "won") best = Math.max(best, ++run);
    else if (row.result === "lost") run = 0;
  }
  return best;
}
