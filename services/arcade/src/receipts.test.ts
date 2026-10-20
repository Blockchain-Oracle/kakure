import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { receiptId, solvePow, weekOf } from "@kakure/arcade";
import { blind, unblind } from "@kakure/ecash";
import { publicKeyFor, signDocument } from "@kakure/signing";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { register } from "./handlers";
import { betsBoard, publishReceipt, readProfile, retractReceipt } from "./receipts";
import { ArcadeStore } from "./store";

const now = () => Math.floor(Date.now() / 1000);
const { Point } = secp256k1;
const N = Point.CURVE().n;
const random = () => BigInt(`0x${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`) % N;
const hex = (n: bigint) => n.toString(16).padStart(64, "0");

/** The operator's two receipt keys, as the test plays it. */
const kRight = random();
const kWrong = random();
const keys = { right: Point.BASE.multiply(kRight).toHex(true), wrong: Point.BASE.multiply(kWrong).toHex(true) };
const receiptKeys = async () => keys;

/** A blind receipt as the device ends up with it: blinded, signed with a DLEQ proof, unblinded. */
function token(right: boolean, k = right ? kRight : kWrong) {
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const { B_, r } = blind(utf8ToBytes(secret));
  const K = Point.BASE.multiply(k);
  const C_ = Point.fromHex(B_).multiply(k);
  const p = random();
  const R1 = Point.BASE.multiply(p);
  const R2 = Point.fromHex(B_).multiply(p);
  const e = BigInt(`0x${bytesToHex(sha256(utf8ToBytes([R1, R2, K, C_].map((x) => x.toHex(false)).join(""))))}`);
  const s = (p + (((e % N) * k) % N)) % N;
  return {
    v: 2,
    network: "testnet",
    right,
    secret,
    C: unblind(C_.toHex(true), r, K.toHex(true)),
    dleq: { e: hex(e), s: hex(s), r: hex(r) },
  };
}

describe("published receipts", () => {
  const secretKey = new Uint8Array(32).fill(21);
  const player = Buffer.from(publicKeyFor(secretKey)).toString("hex");
  const publish = (store: ArcadeStore, t: Record<string, unknown>) =>
    publishReceipt(store, signDocument({ action: "publish", player, token: t, at: now() }, secretKey), receiptKeys);
  const retract = (store: ArcadeStore, receipt: string) =>
    retractReceipt(store, signDocument({ action: "retract", player, receipt, at: now() }, secretKey));

  let stores = 0;
  function storeWithNickname(): ArcadeStore {
    const store = new ArcadeStore(":memory:");
    const nickname = "Caller";
    // Each store's claim is its own request (a byte-identical copy would be refused as a replay).
    stores += 1;
    const at = now() - 30 * stores;
    register(store, signDocument({ player, nickname, nonce: solvePow({ player, nickname }), at }, secretKey));
    return store;
  }

  it("accepts a blind receipt the operator's keys check, and keeps only its id, the verdict and the week", async () => {
    const store = storeWithNickname();
    const right = token(true);
    assert.deepEqual(await publish(store, right), {
      ok: true,
      body: { receipt: receiptId(right.secret), right: true },
    });
    // A wrong call signed with the right key, a verdict the signature doesn't back, a changed secret, another network.
    assert.equal((await publish(store, token(false, kRight))).ok, false);
    assert.equal((await publish(store, { ...token(true), right: false })).ok, false);
    assert.equal((await publish(store, { ...token(true), secret: "0".repeat(64) })).ok, false);
    assert.equal((await publish(store, { ...token(true), network: "mainnet" })).ok, false);
    // A copy of the same signed request is refused.
    const request = signDocument({ action: "publish", player, token: token(false), at: now() }, secretKey);
    assert.equal((await publishReceipt(store, request, receiptKeys)).ok, true);
    assert.equal((await publishReceipt(store, request, receiptKeys)).ok, false);
  });

  it("changes the board once a week, retractions included", () => {
    const store = storeWithNickname();
    const week = weekOf(now());
    const ids = Array.from({ length: 6 }, (_, i) => receiptId(`secret-${i}`));
    for (let i = 0; i < 5; i++) store.receipts.add(ids[i] ?? "", player, i < 3, week - 2);
    store.receipts.add(ids[5] ?? "", player, true, week);
    assert.deepEqual(betsBoard(store, "all").rows, [{ nickname: "Caller", right: 3, calls: 5 }]);
    assert.deepEqual(betsBoard(store, "week").rows, []);
    const profile = readProfile(store, { nickname: "caller" });
    assert.equal(profile.ok && profile.body.bets?.calls, 5);
    assert.ok(profile.ok && profile.body.badges.includes("caller"));
    // Taken back this week: still counted until the week turns, then gone.
    assert.equal(retract(store, ids[0] ?? "").ok, true);
    assert.deepEqual(betsBoard(store, "all").rows, [{ nickname: "Caller", right: 3, calls: 5 }]);
    assert.deepEqual(store.receipts.tally(player, week + 1), { right: 3, calls: 5 });
    store.receipts.sweep(week + 1);
    assert.equal(store.receipts.holder(ids[0] ?? ""), null);
    // A call this key never put up can't be taken back.
    assert.equal(retract(store, receiptId("never")).ok, false);
  });
});
