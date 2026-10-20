import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { receiptId, solvePow } from "@kakure/arcade";
import type { WindowState } from "@kakure/domain";
import { publicKeyFor, signDocument } from "@kakure/signing";
import { register } from "./handlers";
import { betsBoard, publishReceipt, readProfile, retractReceipt } from "./receipts";
import { ArcadeStore } from "./store";

const now = () => Math.floor(Date.now() / 1000);
const operatorSecret = new Uint8Array(32).fill(11);
const WINDOW = "btc-5m-1792504800";

function window(outcome: WindowState["outcome"], trades?: number): WindowState {
  return {
    id: WINDOW,
    startsAt: "2026-10-20T14:00:00Z",
    expiresAt: "2026-10-20T14:05:00Z",
    outcome,
    ...(trades === undefined ? {} : { trades, volumeZat: "3000000" }),
  };
}

function certificate(lock: string, extra: Record<string, unknown> = {}) {
  return signDocument(
    {
      id: `p-${lock}`,
      kind: "single",
      window: WINDOW,
      side: "U",
      stakeZat: "1000000",
      askE4: 5_000,
      payoutZat: "2000000",
      openedAt: 1_792_504_810,
      lock,
      ...extra,
    },
    operatorSecret,
  );
}

describe("published receipts", () => {
  const secret = new Uint8Array(32).fill(21);
  const player = Buffer.from(publicKeyFor(secret)).toString("hex");
  const sources = (w: WindowState) => ({
    operator: () => publicKeyFor(operatorSecret),
    windowOf: async () => w,
  });
  const publish = (store: ArcadeStore, cert: Record<string, unknown>, w: WindowState, key = secret, who = player) =>
    publishReceipt(
      store,
      signDocument({ action: "publish", player: who, certificate: cert, at: now() }, key),
      sources(w),
    );

  function storeWithNickname(): ArcadeStore {
    const store = new ArcadeStore(":memory:");
    const nickname = "Caller";
    register(store, signDocument({ player, nickname, nonce: solvePow({ player, nickname }), at: now() }, secret));
    return store;
  }

  it("accepts a right call on a crowded Window, and keeps only its id, key, verdict and day", async () => {
    const store = storeWithNickname();
    const accepted = await publish(store, certificate("lock-1"), window("U", 3));
    assert.deepEqual(accepted, { ok: true, body: { receipt: receiptId("lock-1"), right: true } });
    // The same position again is the same receipt.
    assert.equal((await publish(store, certificate("lock-1", { id: "p-reissued" }), window("U", 3))).ok, true);
    assert.deepEqual(store.receipts.tally(player, 99_999_999), { right: 1, calls: 1 });
  });

  it("refuses what would single a position out, decides nothing, or isn't the operator's", async () => {
    const store = storeWithNickname();
    assert.equal((await publish(store, certificate("lock-2"), window("U", undefined))).ok, false);
    assert.equal((await publish(store, certificate("lock-3"), window("refund", 6))).ok, false);
    assert.equal((await publish(store, certificate("lock-4", { kind: "parlay" }), window("U", 6))).ok, false);
    const forged = { ...certificate("lock-5"), side: "D" };
    assert.equal((await publish(store, forged, window("D", 6))).ok, false);
  });

  it("counts a nickname on the board from five receipts published before today, and retracts", async () => {
    const store = storeWithNickname();
    for (let i = 0; i < 5; i++) store.receipts.add(receiptId(`lock-${i}`), player, i < 3, 20_261_001);
    store.receipts.add(receiptId("lock-today"), player, true, 99_999_999);
    const board = betsBoard(store, "all");
    assert.deepEqual(board.rows, [{ nickname: "Caller", right: 3, calls: 5 }]);
    const profile = readProfile(store, { nickname: "caller" });
    assert.equal(profile.ok && profile.body.bets?.calls, 5);
    assert.ok(profile.ok && profile.body.badges.includes("caller"));
    const retracted = retractReceipt(
      store,
      signDocument({ action: "retract", player, receipt: receiptId("lock-0"), at: now() }, secret),
    );
    assert.equal(retracted.ok, true);
    assert.deepEqual(betsBoard(store, "all").rows, []);
  });
});
