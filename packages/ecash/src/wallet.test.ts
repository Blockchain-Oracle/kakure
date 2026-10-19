import assert from "node:assert/strict";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import vectors from "./nut02-v2-vectors.json" with { type: "json" };
import { checkKeyset, finishOutputs, keysetIdV2, prepareOutputs, split, total } from "./wallet";

/** NUT-02 v2 keyset IDs from the spec (github.com/cashubtc/nuts tests/02-tests.md, vectors 1 and 3). */
test("NUT-02 keyset ID v2", () => {
  for (const v of vectors) {
    assert.equal(keysetIdV2(v.keys, v.unit, v.fee, v.expiry ?? undefined), v.id);
  }
});

const { Point } = secp256k1;
const LADDER = [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000];
/** A toy mint with private key (index + 2) per amount, to exercise the whole wallet path. */
const secretKeys = new Map(LADDER.map((amount, i) => [amount, BigInt(i + 2)]));
const keys = Object.fromEntries(
  LADDER.map((a) => [String(a), Point.BASE.multiply(secretKeys.get(a) ?? 1n).toHex(true)]),
);
const keyset = { id: keysetIdV2(keys, "zat"), unit: "zat", keys };

test("splits on the 1-2-5 ladder and refuses dust", () => {
  assert.deepEqual(split(keyset, 1_300_000), [1_000_000, 200_000, 100_000]);
  assert.equal(split(keyset, 150_000), null);
  assert.equal(checkKeyset(keyset), true);
  assert.equal(checkKeyset({ ...keyset, id: `${keyset.id.slice(0, -1)}0` }), false);
});

test("prepare → sign → finish gives chips, and a signature under another key is refused", () => {
  const pending = prepareOutputs(keyset, 1_700_000);
  assert.deepEqual(
    pending.outputs.map((o) => o.amount),
    [200_000, 500_000, 1_000_000],
    "ascending",
  );
  // The toy mint signs with a DLEQ proof (NUT-12), as the operator's `cashu` crate does.
  const signatures = pending.outputs.map((o) => {
    const k = secretKeys.get(o.amount) ?? 1n;
    const B = Point.fromHex(o.B_);
    const C = B.multiply(k);
    const r = 7n;
    const R1 = Point.BASE.multiply(r);
    const R2 = B.multiply(r);
    const A = Point.BASE.multiply(k);
    const e = BigInt(`0x${Buffer.from(sha(R1, R2, A, C)).toString("hex")}`);
    const s = (r + e * k) % Point.CURVE().n;
    return {
      amount: o.amount,
      id: keyset.id,
      C_: C.toHex(true),
      dleq: { e: e.toString(16).padStart(64, "0"), s: s.toString(16).padStart(64, "0") },
    };
  });
  const chips = finishOutputs(keyset, pending, signatures);
  assert.equal(total(chips), 1_700_000);
  const wrongKey = signatures.map((sig) => ({ ...sig, C_: Point.fromHex(sig.C_).multiply(3n).toHex(true) }));
  assert.throws(() => finishOutputs(keyset, pending, wrongKey), /DLEQ/);
});

function sha(...points: InstanceType<typeof Point>[]) {
  return sha256(utf8ToBytes(points.map((p) => p.toHex(false)).join("")));
}
