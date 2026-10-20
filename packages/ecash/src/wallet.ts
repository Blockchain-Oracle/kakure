import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { blind, hashToCurve, unblind, verifyDleq } from "./bdhke";

/**
 * A chip wallet's bookkeeping over the BDHKE primitives (plan §00): checking the keyset the signed bundle publishes,
 * splitting an amount into the keyset's denominations, blinding fresh secrets, and turning the mint's blind signatures
 * into spendable chips only after each one's DLEQ proof checks out against the published key. Amounts are zatoshi.
 */

/** NUT-01/02: `{ id, unit, keys: { amount: compressed pubkey } }`, as the bundle's `trading.keyset`. */
export interface Keyset {
  id: string;
  unit: string;
  keys: Readonly<Record<string, string>>;
}

/** NUT-00 shapes on the wire. */
export interface BlindedMessage {
  amount: number;
  id: string;
  B_: string;
}

export interface BlindSignature {
  amount: number;
  id: string;
  C_: string;
  dleq?: { e: string; s: string };
}

/** A spendable chip. Never sent anywhere but the mint, and only when spent. */
export interface Proof {
  amount: number;
  id: string;
  secret: string;
  C: string;
}

/** Outputs waiting for the mint's signatures, with what's needed to unblind them. */
export interface PendingOutputs {
  outputs: BlindedMessage[];
  secrets: string[];
  rs: bigint[];
}

const SECRET_BYTES = 32;
const KEYSET_VERSION_V2 = "01";
/** A 1-2-5 split needs at most three chips per decade (e.g. 9 = 5 + 2 + 2). */
const CHIPS_PER_DECADE = 3;
const DECADE = 10;

/**
 * NUT-02 keyset ID v2: `01` ‖ SHA-256("amount:pubkey,…|unit:<unit>[|input_fee_ppk:<n>][|final_expiry:<t>]"), keys
 * ascending by amount (compared as integers: spec amounts pass 2^53), the fee only when non-zero.
 */
export function keysetIdV2(keys: Keyset["keys"], unit: string, inputFeePpk = 0, finalExpiry?: number): string {
  const pairs = Object.entries(keys)
    .sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
    .map(([amount, pubkey]) => `${amount}:${pubkey}`)
    .join(",");
  const fee = inputFeePpk > 0 ? `|input_fee_ppk:${inputFeePpk}` : "";
  const expiry = finalExpiry === undefined ? "" : `|final_expiry:${finalExpiry}`;
  return KEYSET_VERSION_V2 + bytesToHex(sha256(utf8ToBytes(`${pairs}|unit:${unit}${fee}${expiry}`)));
}

/** The keyset is only used when its id is what its keys hash to (the wallet computes it itself, NUT-02). */
export function checkKeyset(keyset: Keyset): boolean {
  return keysetIdV2(keyset.keys, keyset.unit) === keyset.id;
}

/** The keyset's denominations, largest first. */
export function denominations(keyset: Keyset): number[] {
  return Object.keys(keyset.keys)
    .map(Number)
    .sort((a, b) => b - a);
}

/** Greedy split over the keyset's own denominations; null when `zat` can't be made exactly. */
export function split(keyset: Keyset, zat: number): number[] | null {
  const out: number[] = [];
  let left = zat;
  for (const amount of denominations(keyset)) {
    while (left >= amount) {
      out.push(amount);
      left -= amount;
    }
  }
  return left === 0 ? out : null;
}

/** A NUT-00 secret: 32 random bytes as 64 lowercase hex characters ("to prevent fingerprinting"). */
export function newSecret(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

/** Blinded outputs worth `zat`, sorted ascending (NUT-03: so the mint can't read a payment amount from the order). */
export function prepareOutputs(keyset: Keyset, zat: number): PendingOutputs {
  const amounts = split(keyset, zat);
  if (!amounts) throw new Error(`${zat} zat can't be made from this keyset's chips`);
  amounts.sort((a, b) => a - b);
  const pending: PendingOutputs = { outputs: [], secrets: [], rs: [] };
  for (const amount of amounts) {
    const secret = newSecret();
    const { B_, r } = blind(utf8ToBytes(secret));
    pending.outputs.push({ amount, id: keyset.id, B_ });
    pending.secrets.push(secret);
    pending.rs.push(r);
  }
  return pending;
}

/**
 * The mint's signatures → chips. Each signature must match its output (amount, keyset), carry a DLEQ proof, and the
 * proof must check against the published key for its amount; otherwise nothing is kept and the call throws.
 */
export function finishOutputs(keyset: Keyset, pending: PendingOutputs, signatures: readonly BlindSignature[]): Proof[] {
  if (signatures.length !== pending.outputs.length) throw new Error("the mint answered the wrong number of signatures");
  return signatures.map((signature, i) => {
    const output = pending.outputs[i];
    const secret = pending.secrets[i];
    const r = pending.rs[i];
    const key = keyset.keys[String(signature.amount)];
    if (!output || secret === undefined || r === undefined || !key) throw new Error("unexpected signature");
    if (signature.amount !== output.amount || signature.id !== keyset.id) throw new Error("signature mismatch");
    if (!signature.dleq || !verifyDleq(signature.dleq, output.B_, signature.C_, key)) {
      throw new Error("a signature's DLEQ proof failed: the mint didn't sign with its published key");
    }
    return { amount: signature.amount, id: keyset.id, secret, C: unblind(signature.C_, r, key) };
  });
}

/**
 * Blank outputs (NUT-08 style) for proceeds the mint values: a close, a redeem, an exit that fires later. Each is a fresh
 * blinded secret with no amount; the mint signs the value's 1-2-5 split onto the first ones and leaves the rest.
 */
export function prepareBlank(keyset: Keyset, count: number): PendingOutputs {
  const pending: PendingOutputs = { outputs: [], secrets: [], rs: [] };
  for (let i = 0; i < count; i++) {
    const secret = newSecret();
    const { B_, r } = blind(utf8ToBytes(secret));
    pending.outputs.push({ amount: 0, id: keyset.id, B_ });
    pending.secrets.push(secret);
    pending.rs.push(r);
  }
  return pending;
}

/** How many blank outputs a value up to `max` may need: three per decade from the smallest chip (as the mint counts). */
export function blankCount(keyset: Keyset, max: number): number {
  const smallest = Math.min(...Object.keys(keyset.keys).map(Number));
  let count = 0;
  for (let unit = smallest; unit <= max; unit *= DECADE) count += CHIPS_PER_DECADE;
  return count;
}

/**
 * Blank outputs for any value the keyset can sign: the same count on every close, redeem and exit, so the request
 * never says what the position is worth (privacy re-audit V4). The mint signs only the ones the value needs.
 */
export function ladderBlankCount(keyset: Keyset): number {
  return blankCount(keyset, Math.max(...Object.keys(keyset.keys).map(Number)));
}

/**
 * The mint's signatures on blank outputs → chips. It signs the first outputs in order, any amount of the keyset; each
 * must carry a DLEQ proof against the published key for its amount, and together they must make `value`.
 */
export function finishBlank(
  keyset: Keyset,
  pending: PendingOutputs,
  signatures: readonly BlindSignature[],
  value: number,
): Proof[] {
  if (signatures.length > pending.outputs.length) throw new Error("the mint signed more outputs than were sent");
  const chips = signatures.map((signature, i) => {
    const output = pending.outputs[i];
    const secret = pending.secrets[i];
    const r = pending.rs[i];
    const key = keyset.keys[String(signature.amount)];
    if (!output || secret === undefined || r === undefined || !key) throw new Error("unexpected signature");
    if (signature.id !== keyset.id) throw new Error("signature mismatch");
    if (!signature.dleq || !verifyDleq(signature.dleq, output.B_, signature.C_, key)) {
      throw new Error("a signature's DLEQ proof failed: the mint didn't sign with its published key");
    }
    return { amount: signature.amount, id: keyset.id, secret, C: unblind(signature.C_, r, key) };
  });
  if (total(chips) !== value) throw new Error("the signed chips don't add up to the value");
  // The mint must pay in the canonical split, largest first, as everyone is paid: a rare mix of amounts could mark
  // whoever receives it, and DLEQ alone can't stop that (privacy re-audit V9).
  const canonical = split(keyset, value);
  if (!canonical || canonical.length !== chips.length || canonical.some((amount, i) => amount !== chips[i]?.amount)) {
    throw new Error("the mint paid in an unusual mix of chips");
  }
  return chips;
}

/** `Y = hash_to_curve(secret)` (compressed hex): the chip's key in the mint's spent set (NUT-07). */
export function chipY(proof: Pick<Proof, "secret">): string {
  return hashToCurve(utf8ToBytes(proof.secret)).toHex(true);
}

export function total(proofs: readonly Pick<Proof, "amount">[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Chips for a spend of `zat` (privacy re-audit V3): exact when the wallet can make it, so no change comes back and the
 * spend's amounts don't chain it to the next one. First the largest chips that still fit (exact on the 1-2-5 ladder
 * whenever the pieces are there), then the smallest single chip that covers it, and only then the largest-first set.
 */
export function select(proofs: readonly Proof[], zat: number): Proof[] | null {
  const sorted = [...proofs].sort((a, b) => b.amount - a.amount);
  const exact: Proof[] = [];
  let left = zat;
  for (const proof of sorted) {
    if (left === 0) break;
    if (proof.amount <= left) {
      exact.push(proof);
      left -= proof.amount;
    }
  }
  if (left === 0) return exact;
  const single = sorted.findLast((proof) => proof.amount >= zat);
  if (single) return [single];
  const chosen: Proof[] = [];
  let sum = 0;
  for (const proof of sorted) {
    if (sum >= zat) break;
    chosen.push(proof);
    sum += proof.amount;
  }
  return sum >= zat ? chosen : null;
}
