import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TICKET_SIZES_ZAT } from "./constants";
import { ladderFloor } from "./fair";
import { type BetMemo, decodeBetMemo, encodeBetMemo } from "./memo";
import { canonicalNotes, payoutZat, quoteTicket, refundZat, settlement } from "./payout";
import { ticketHashHex } from "./ticket";
import { zatToZec, zecToZat } from "./units";
import { buildPaymentUri, parsePaymentUri } from "./zip321";

// A real testnet Orchard-only address produced by the operator smoke test (S00).
const TESTNET_UA =
  "utest1mfrx6suz2urywesnq6u5y09n5njsv5yctgk44e5wp0tk8wyk97yr8xf5wt6zjdxelkqu663jeflflyxc2amktcflw03xjpfmjcgmy0w7";
const NONCE = Uint8Array.from({ length: 16 }, (_, index) => index);

const bet: BetMemo = {
  network: "testnet",
  marketId: "btc-1h-2610171600",
  side: "U",
  sizeZat: 10_000_000n,
  nonce: NONCE,
  payoutAddress: TESTNET_UA,
};

describe("bet memo", () => {
  it("round-trips and stays under 511 bytes", () => {
    const memo = encodeBetMemo(bet);
    assert.ok(new TextEncoder().encode(memo).length <= 511);
    assert.deepEqual(decodeBetMemo(memo), bet);
  });

  it("ignores Zingo's reply-to tail", () => {
    const memo = `${encodeBetMemo(bet)}\nReply to:\n${TESTNET_UA}`;
    assert.equal(decodeBetMemo(memo).marketId, bet.marketId);
  });

  it("rejects a non-ticket size, a reordered field and a wrong-network address", () => {
    assert.throws(() => encodeBetMemo({ ...bet, sizeZat: 1_234_567n }));
    assert.throws(() => decodeBetMemo(encodeBetMemo(bet).replace(";n=t;m=", ";m=").replace(";s=", ";n=t;s=")));
    assert.throws(() => encodeBetMemo({ ...bet, network: "mainnet" }));
  });
});

describe("ticket hash", () => {
  it("binds side and size", () => {
    const base = ticketHashHex(bet);
    assert.notEqual(base, ticketHashHex({ ...bet, side: "D" }));
    assert.notEqual(base, ticketHashHex({ ...bet, sizeZat: 20_000_000n }));
    assert.notEqual(base, ticketHashHex({ ...bet, network: "mainnet" }));
    assert.match(base, /^[0-9a-f]{64}$/);
  });
});

describe("payouts", () => {
  it("pays Codex's sparse example honestly: 3 × 0.01 a side → 0.02 each (house absorbs rounding)", () => {
    assert.equal(payoutZat(1_000_000n, 3_000_000n, 3_000_000n), 2_000_000n);
  });

  it("charges the 2 % fee on the losing side only", () => {
    // 1 ZEC wins against a 1 ZEC losing pool: winnings 0.98 ZEC.
    assert.equal(payoutZat(100_000_000n, 100_000_000n, 100_000_000n), 198_000_000n);
  });

  it("never overflows with large pools", () => {
    const big = 10_000_000_000_000n; // 100,000 ZEC per side
    assert.equal(payoutZat(100_000_000n, big, big), 198_000_000n);
  });

  it("refunds thin pools and keeps dust", () => {
    assert.deepEqual(settlement({ tickets: 2, zat: 2_000_000n }, { tickets: 5, zat: 5_000_000n }), {
      kind: "refund",
      reason: "thin-pool",
    });
    assert.equal(refundZat(99_999n), 0n);
    assert.equal(refundZat(100_000n), 100_000n);
  });

  it("splits every payout into canonical 1/2/5 × 10^k notes that sum back exactly", () => {
    for (const size of TICKET_SIZES_ZAT) {
      for (const amount of [payoutZat(size, 7_000_000n, 3_000_000n), 1_900_000n, 123_400_000n]) {
        const notes = canonicalNotes(amount);
        assert.equal(
          notes.reduce((sum, note) => sum + note, 0n),
          amount,
        );
        for (const note of notes) {
          assert.match(note.toString(), /^[125]0*$/);
        }
      }
    }
  });
});

describe("ZIP 321", () => {
  it("round-trips a bet payment with a base64url memo", () => {
    const memo = encodeBetMemo(bet);
    const uri = buildPaymentUri({ address: TESTNET_UA, amountZat: bet.sizeZat, memo });
    assert.ok(!/[+/=]/.test(uri.split("memo=")[1] ?? ""));
    assert.deepEqual(parsePaymentUri(uri), { address: TESTNET_UA, amountZat: bet.sizeZat, memo });
  });

  it("rejects multi-payment and unknown required parameters", () => {
    assert.throws(() => parsePaymentUri(`zcash:?address=${TESTNET_UA}&amount=1&address.1=${TESTNET_UA}&amount.1=1`));
    assert.throws(() => parsePaymentUri(`zcash:${TESTNET_UA}?amount=1&req-future=1`));
  });

  it("converts units exactly", () => {
    assert.equal(zatToZec(1_000_000n), "0.01");
    assert.equal(zecToZat("0.00000001"), 1n);
    assert.throws(() => zecToZat("0.000000001"));
  });
});

describe("ticket quote", () => {
  it("adds the bettor's stake to their side before quoting", () => {
    // 0.1 ZEC into Up with 0.3 Up / 0.3 Down already: payoutZat(0.1, 0.4, 0.3) = 0.1 + 0.1·0.3·0.98/0.4 → 0.174 on the grid.
    const quote = quoteTicket(10_000_000n, 30_000_000n, 30_000_000n);
    assert.equal(quote.payoutZat, payoutZat(10_000_000n, 40_000_000n, 30_000_000n));
    assert.equal(quote.profitZat, quote.payoutZat - 10_000_000n);
    assert.equal(quote.multipleBps, (quote.payoutZat * 10_000n) / 10_000_000n);
  });

  it("pays the stake back when the other side is empty", () => {
    const quote = quoteTicket(1_000_000n, 0n, 0n);
    assert.equal(quote.payoutZat, 1_000_000n);
    assert.equal(quote.multipleBps, 10_000n);
  });
});

it("stakes snap down to the chip ladder", () => {
  assert.equal(ladderFloor(73_100_000), 50_000_000);
  assert.equal(ladderFloor(5_000_000), 5_000_000);
  assert.equal(ladderFloor(1_999_999), 1_000_000);
  assert.equal(ladderFloor(250_000), 200_000);
  assert.equal(ladderFloor(500), 1_000);
});
