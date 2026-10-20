import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solvePow, weekOf } from "@kakure/arcade";
import { publicKeyFor, signDocument } from "@kakure/signing";
import { register } from "./handlers";
import { betsBoard, publishReceipt, readProfile, retractReceipt } from "./receipts";
import { ArcadeStore } from "./store";

const now = () => Math.floor(Date.now() / 1000);
const operatorSecret = new Uint8Array(32).fill(11);
const operator = () => publicKeyFor(operatorSecret);
const hex = (n: number) => n.toString(16).padStart(64, "0");

describe("published receipts", () => {
  const secret = new Uint8Array(32).fill(21);
  const player = Buffer.from(publicKeyFor(secret)).toString("hex");
  /** The operator's token for a call, as `POST /v1/receipt` signs it. */
  const token = (receipt: string, right: boolean, extra: Record<string, unknown> = {}) =>
    signDocument(
      { v: 1, type: "kakure-receipt", network: "testnet", receipt, right, player, ...extra },
      operatorSecret,
    );
  const publish = (store: ArcadeStore, t: Record<string, unknown>, key = secret, who = player) =>
    publishReceipt(store, signDocument({ action: "publish", player: who, token: t, at: now() }, key), operator);
  const retract = (store: ArcadeStore, receipt: string) =>
    retractReceipt(store, signDocument({ action: "retract", player, receipt, at: now() }, secret));

  function storeWithNickname(): ArcadeStore {
    const store = new ArcadeStore(":memory:");
    const nickname = "Caller";
    register(store, signDocument({ player, nickname, nonce: solvePow({ player, nickname }), at: now() }, secret));
    return store;
  }

  it("accepts only the operator's token for this key, and keeps the verdict and the week", async () => {
    const store = storeWithNickname();
    assert.deepEqual(await publish(store, token(hex(1), true)), { ok: true, body: { receipt: hex(1), right: true } });
    assert.equal((await publish(store, { ...token(hex(2), true), right: false })).ok, false);
    assert.equal((await publish(store, token(hex(3), true, { player: hex(9) }))).ok, false);
    assert.equal((await publish(store, token(hex(4), true, { network: "mainnet" }))).ok, false);
    // A copy of the same signed request is refused.
    const request = signDocument({ action: "publish", player, token: token(hex(5), true), at: now() }, secret);
    assert.equal((await publishReceipt(store, request, operator)).ok, true);
    assert.equal((await publishReceipt(store, request, operator)).ok, false);
  });

  it("changes the board once a week, retractions included", () => {
    const store = storeWithNickname();
    const week = weekOf(now());
    for (let i = 0; i < 5; i++) store.receipts.add(hex(10 + i), player, i < 3, week - 2);
    store.receipts.add(hex(20), player, true, week);
    assert.deepEqual(betsBoard(store, "all").rows, [{ nickname: "Caller", right: 3, calls: 5 }]);
    assert.deepEqual(betsBoard(store, "week").rows, []);
    const profile = readProfile(store, { nickname: "caller" });
    assert.equal(profile.ok && profile.body.bets?.calls, 5);
    assert.ok(profile.ok && profile.body.badges.includes("caller"));
    // Taken back this week: still counted until the week turns, then gone.
    assert.equal(retract(store, hex(10)).ok, true);
    assert.deepEqual(betsBoard(store, "all").rows, [{ nickname: "Caller", right: 3, calls: 5 }]);
    assert.deepEqual(store.receipts.tally(player, week + 1), { right: 3, calls: 5 });
    store.receipts.sweep(week + 1);
    assert.equal(store.receipts.holder(hex(10)), null);
    // A call this key never put up can't be taken back.
    assert.equal(retract(store, hex(99)).ok, false);
  });
});
