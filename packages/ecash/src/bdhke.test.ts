import assert from "node:assert/strict";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { blind, hashE, hashToCurve, unblind, verifyDleq, verifyUnblinded } from "./bdhke";

/** Every vector here is copied from the Cashu specs: github.com/cashubtc/nuts tests/00-tests.md and tests/12-tests.md. */
const { Point } = secp256k1;
const big = (hex: string) => BigInt(`0x${hex}`);

test("NUT-00 hash_to_curve", () => {
  const cases: Array<[string, string]> = [
    [
      "0000000000000000000000000000000000000000000000000000000000000000",
      "024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725",
    ],
    [
      "0000000000000000000000000000000000000000000000000000000000000001",
      "022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf",
    ],
    [
      "0000000000000000000000000000000000000000000000000000000000000002",
      "026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f",
    ],
  ];
  for (const [message, point] of cases) assert.equal(hashToCurve(hexToBytes(message)).toHex(true), point);
});

test("NUT-00 blinded messages", () => {
  const cases: Array<[string, string, string]> = [
    [
      "d341ee4871f1f889041e63cf0d3823c713eea6aff01e80f1719f08f9e5be98f6",
      "99fce58439fc37412ab3468b73db0569322588f62fb3a49182d67e23d877824a",
      "033b1a9737a40cc3fd9b6af4b723632b76a67a36782596304612a6c2bfb5197e6d",
    ],
    [
      "f1aaf16c2239746f369572c0784d9dd3d032d952c2d992175873fb58fae31a60",
      "f78476ea7cc9ade20f9e05e58a804cf19533f03ea805ece5fee88c8e2874ba50",
      "029bdf2d716ee366eddf599ba252786c1033f47e230248a4612a5670ab931f1763",
    ],
  ];
  for (const [x, r, B_] of cases) assert.equal(blind(hexToBytes(x), big(r)).B_, B_);
});

test("NUT-00 blinded signatures, and unblinding gives k·Y", () => {
  const B_ = "02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2";
  const k = big("7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f");
  assert.equal(
    Point.fromHex(B_).multiply(k).toHex(true),
    "0398bc70ce8184d27ba89834d19f5199c84443c31131e48d3c1214db24247d005d",
  );
  // A whole round trip: blind, the mint signs C_ = k·B_, unblind C = C_ − r·K, and C == k·Y.
  const secret = utf8ToBytes("daf4dd00a2b68a0858a80450f52c8a7d2ccf87d375e43e216e0c571f089f63e9");
  const { B_: blinded, r } = blind(secret);
  const K = Point.BASE.multiply(k).toHex(true);
  const C_ = Point.fromHex(blinded).multiply(k).toHex(true);
  assert.equal(unblind(C_, r, K), hashToCurve(secret).multiply(k).toHex(true));
});

test("NUT-12 hash_e", () => {
  const one = "020000000000000000000000000000000000000000000000000000000000000001";
  const points = [one, one, one, "02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2"].map((p) =>
    Point.fromHex(p),
  );
  assert.equal(bytesToHex(hashE(points)), "a4dc034b74338c28c6bc3ea49731f2a24440fc7c4affc08b31a93fc9fbe6401e");
});

test("NUT-12 DLEQ on a blind signature (and a tampered one fails)", () => {
  const A = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const B_ = "02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2";
  const C_ = "02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2";
  const dleq = {
    e: "9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73d9",
    s: "9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73da",
  };
  assert.equal(verifyDleq(dleq, B_, C_, A), true);
  assert.equal(verifyDleq({ ...dleq, s: dleq.e }, B_, C_, A), false);
  const otherKey = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
  assert.equal(verifyDleq(dleq, B_, C_, otherKey), false, "a signature under another key is caught");
});

test("NUT-12 DLEQ on a proof, rebuilt from its blinding factor", () => {
  const A = Point.fromHex("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  const secret = utf8ToBytes("daf4dd00a2b68a0858a80450f52c8a7d2ccf87d375e43e216e0c571f089f63e9");
  const C = Point.fromHex("024369d2d22a80ecf78f3937da9d5f30c1b9f74f0c32684d583cca0fa6a61cdcfc");
  const r = big("a6d13fcd7a18442e6076f5e1e7c887ad5de40a019824bdfa9fe740d302e8d861");
  // Carol rebuilds B' = Y + rG and C' = C + rA, then checks the DLEQ (NUT-12).
  const B_ = blind(secret, r).B_;
  const C_ = C.add(A.multiply(r)).toHex(true);
  const dleq = {
    e: "b31e58ac6527f34975ffab13e70a48b6d2b0d35abc4b03f0151f09ee1a9763d4",
    s: "8fbae004c59e754d71df67e392b6ae4e29293113ddc2ec86592a0431d16306d8",
  };
  assert.equal(verifyDleq(dleq, B_, C_, A.toHex(true)), true);
});

test("NUT-12 third-party check of an unblinded token (a different key or a changed secret fails)", () => {
  const { Point } = secp256k1;
  const N = Point.CURVE().n;
  const rand = () => BigInt(`0x${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`) % N;
  const k = rand();
  const K = Point.BASE.multiply(k).toHex(true);
  const other = Point.BASE.multiply(rand()).toHex(true);
  const secret = utf8ToBytes(bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
  const { B_, r } = blind(secret);
  // The signer: C_ = k·B_, with a DLEQ proof (R1 = pG, R2 = pB_, e = hash(R1, R2, K, C_), s = p + ek).
  const C_ = Point.fromHex(B_).multiply(k);
  const p = rand();
  const e = BigInt(
    `0x${bytesToHex(hashE([Point.BASE.multiply(p), Point.fromHex(B_).multiply(p), Point.fromHex(K), C_]))}`,
  );
  const s = (p + (((e % N) * k) % N)) % N;
  const hex = (n: bigint) => n.toString(16).padStart(64, "0");
  const dleq = { e: hex(e), s: hex(s), r: hex(r) };
  const C = unblind(C_.toHex(true), r, K);
  assert.equal(verifyUnblinded({ secret, C, dleq }, K), true);
  assert.equal(verifyUnblinded({ secret, C, dleq }, other), false);
  assert.equal(verifyUnblinded({ secret: utf8ToBytes("changed"), C, dleq }, K), false);
});
