import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Cashu's blind Diffie-Hellman key exchange (NUT-00) and DLEQ check (NUT-12), on @noble/curves: the few functions a
 * chip wallet needs, written against the specs and their official vectors (`bdhke.test.ts`) because the full cashu-ts
 * library (~50 KB gzipped even for these four functions) doesn't tree-shake. The operator mints with the `cashu` crate;
 * the vectors keep the two sides identical.
 */
const { Point } = secp256k1;
type Point = InstanceType<typeof Point>;
const N = Point.CURVE().n;
const DOMAIN_SEPARATOR = utf8ToBytes("Secp256k1_HashToCurve_Cashu_");
const COUNTER_BYTES = 4;
/** Both reference implementations give up after 2^16 counters (the spec sets no cap). */
const MAX_COUNTER = 65_536;
const SCALAR_BYTES = 32;
const EVEN = 0x02;

/** NUT-00: `Y = PublicKey('02' || SHA256(SHA256(separator || message) || counter_le32))`, the first counter on the curve. */
export function hashToCurve(message: Uint8Array): Point {
  const msgHash = sha256(concatBytes(DOMAIN_SEPARATOR, message));
  const counter = new Uint8Array(COUNTER_BYTES);
  const view = new DataView(counter.buffer);
  for (let i = 0; i < MAX_COUNTER; i += 1) {
    view.setUint32(0, i, true);
    const candidate = concatBytes(Uint8Array.of(EVEN), sha256(concatBytes(msgHash, counter)));
    try {
      return Point.fromBytes(candidate);
    } catch {
      // Not on the curve; try the next counter.
    }
  }
  throw new Error("hash_to_curve: no point found");
}

function scalar(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes)}`) % N;
}

/** A uniformly random non-zero scalar for blinding. */
export function randomScalar(): bigint {
  for (;;) {
    const r = scalar(crypto.getRandomValues(new Uint8Array(SCALAR_BYTES)));
    if (r > 0n) return r;
  }
}

/** NUT-00 blinding: `B_ = Y + rG`. Returns `B_` (compressed hex) and the blinding factor `r`. */
export function blind(secret: Uint8Array, r: bigint = randomScalar()): { B_: string; r: bigint } {
  const B = hashToCurve(secret).add(Point.BASE.multiply(r));
  return { B_: B.toHex(true), r };
}

/** NUT-00 unblinding: `C = C_ − rK`, where `K` is the mint's public key for the amount. */
export function unblind(C_: string, r: bigint, K: string): string {
  return Point.fromHex(C_).subtract(Point.fromHex(K).multiply(r)).toHex(true);
}

/** NUT-12 `hash_e`: SHA-256 over the concatenated lowercase hex of each point, uncompressed. */
export function hashE(points: readonly Point[]): Uint8Array {
  return sha256(utf8ToBytes(points.map((p) => p.toHex(false)).join("")));
}

/**
 * NUT-12 DLEQ on a blind signature: proves `C_` was made with the private key behind the published `A` for the
 * blinded message `B_` (`R1 = sG − eA`, `R2 = sB_ − eC_`, `e == hash(R1, R2, A, C_)`). A mint that signed with any
 * other key, to tag one person, fails here.
 */
export function verifyDleq(dleq: { e: string; s: string }, B_: string, C_: string, A: string): boolean {
  try {
    const e = scalar(hexToBytes(dleq.e));
    const s = scalar(hexToBytes(dleq.s));
    const pointA = Point.fromHex(A);
    const pointB = Point.fromHex(B_);
    const pointC = Point.fromHex(C_);
    const R1 = Point.BASE.multiply(s).subtract(pointA.multiply(e));
    const R2 = pointB.multiply(s).subtract(pointC.multiply(e));
    return bytesToHex(hashE([R1, R2, pointA, pointC])) === dleq.e.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * NUT-12 verification by a third party ("Carol"): from a token's secret, its unblinded signature `C` and the DLEQ proof
 * with its blinding factor `r`, anyone holding the signer's public key `K` can check the signature without the signer's
 * help: rebuild `B_ = Y + rG` and `C_ = C + rK`, then check the DLEQ. The Bets board's arcade checks the operator's
 * blind receipts this way (plan §0 R7), so it never needs the operator, and the operator never sees the token.
 */
export function verifyUnblinded(
  token: { secret: Uint8Array; C: string; dleq: { e: string; s: string; r: string } },
  K: string,
): boolean {
  try {
    const r = scalar(hexToBytes(token.dleq.r));
    const key = Point.fromHex(K);
    const B_ = hashToCurve(token.secret).add(Point.BASE.multiply(r));
    const C_ = Point.fromHex(token.C).add(key.multiply(r));
    return verifyDleq({ e: token.dleq.e, s: token.dleq.s }, B_.toHex(true), C_.toHex(true), K);
  } catch {
    return false;
  }
}
