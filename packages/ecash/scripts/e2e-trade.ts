/**
 * Trading end to end against a running operator (plan §00 T3 done-when): mint chips from a confirmed deposit, buy UP
 * (or DOWN) on a BTC 1-minute Window, close one early at the live bid, let one settle and redeem, arm a trail and watch
 * it fire with no client involved, and buy a parlay. Every call goes through the Oblivious HTTP gateway; quotes are
 * computed here the way a browser computes them (the relay's stream, the signed bundle's reference and σ), and every
 * certificate and signature is checked.
 *
 * Usage: pnpm --filter @kakure/ecash e2e-trade <public/<network> dir> <gateway origin> <deposit id> <operator pubkey hex>
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BundleV2,
  closeValueZat,
  currentAndNext,
  DEFAULT_SLIPPAGE_BPS,
  type LaneWindow,
  laneById,
  parlayPayoutZat,
  parlayPriceE8,
  parlayWithSlippage,
  quoteWindow,
  sidePayoutZat,
  withSlippage,
} from "@kakure/domain";
import { obliviousFetch } from "@kakure/ohttp";
import { verifyDocument } from "@kakure/signing";
import {
  blankCount,
  finishBlank,
  finishOutputs,
  type Keyset,
  newSecret,
  type Proof,
  prepareBlank,
  prepareOutputs,
  select,
  total,
} from "../src";

const [dir, gateway, deposit, pubkeyHex] = process.argv.slice(2);
if (!dir || !gateway || !deposit || !pubkeyHex) throw new Error("usage: e2e-trade <dir> <gateway> <deposit> <pubkey>");
const operatorKey = new Uint8Array(Buffer.from(pubkeyHex, "hex"));
const STAKE = 1_000_000;
const RELAY = "wss://kakure-prices.kakure-price-relay.workers.dev/v1/stream";

const step = (name: string) => console.log(`✓ ${name}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

function bundle(): BundleV2 {
  const latest = JSON.parse(readFileSync(join(dir as string, "latest.json"), "utf8"));
  return JSON.parse(readFileSync(join(dir as string, latest.bundle), "utf8"));
}

const first = bundle();
assert.ok(first.trading, "the bundle publishes trading");
const keyset: Keyset = first.trading.keyset;
const oblivious = {
  relay: `${gateway}/gateway`,
  keyConfig: new Uint8Array(Buffer.from(first.trading.gatewayKeys, "base64url")),
};

async function call(path: string, body: unknown) {
  const response = await obliviousFetch(oblivious, "POST", path, JSON.stringify(body));
  return { status: response.status, json: await response.json(), body };
}

/* ── The relay's live prices, as a browser follows them ─────────────────────────────────────────────────────── */
const spot = new Map<string, number>();
const socket = new WebSocket(RELAY);
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as { prices?: Record<string, { p: string }> };
  for (const [symbol, quote] of Object.entries(message.prices ?? {})) spot.set(symbol, Number(quote.p));
});
while (!spot.has("BTC-USD")) await sleep(100);
step(`following the relay: BTC ${spot.get("BTC-USD")}`);

/** A side's quote now, from the latest bundle and the live price. */
function quote(window: LaneWindow, asset: string) {
  const b = bundle();
  const state = b.windows.find((w) => w.id === window.id) ?? null;
  const sigma = Number(b.pricing.sigma[asset as keyof typeof b.pricing.sigma] ?? Number.NaN);
  return quoteWindow(window, state, { spot: spot.get(`${asset}-USD`) ?? null, sigma }, nowSec());
}

/** The current Window of a lane once it's live with enough time left, else the next one when it gets there. */
async function liveWindow(laneId: string, asset: string, minLeft: number): Promise<LaneWindow> {
  const lane = laneById(laneId);
  assert.ok(lane);
  for (;;) {
    const [current] = currentAndNext(lane, nowSec());
    const q = quote(current, asset);
    if (q.phase === "live" && current.expirySec - 30 - nowSec() >= minLeft) return current;
    await sleep(1000);
  }
}

/* ── Chips ──────────────────────────────────────────────────────────────────────────────────────────────────── */
const progress = await (async () => {
  const response = await obliviousFetch(oblivious, "GET", `/v1/deposit/${deposit}`);
  return response.json();
})();
const mintable = Number(progress.mintableZat);
assert.ok(mintable >= 10 * STAKE, `deposit not mintable enough: ${JSON.stringify(progress)}`);
const mintOutputs = prepareOutputs(keyset, mintable);
const minted = await call("/v1/mint/zcash", { deposit, outputs: mintOutputs.outputs });
assert.equal(minted.status, 200, JSON.stringify(minted.json));
let chips: Proof[] = finishOutputs(keyset, mintOutputs, minted.json.signatures);
step(`minted ${total(chips)} zat in ${chips.length} chips on keyset ${keyset.id.slice(0, 10)}…, every DLEQ checked`);

/** Chips worth exactly `stake` plus change outputs, taken out of the wallet. */
function pay(stake: number) {
  const inputs = select(chips, stake);
  assert.ok(inputs, "enough chips");
  chips = chips.filter((c) => !inputs.includes(c));
  const change = total(inputs) > stake ? prepareOutputs(keyset, total(inputs) - stake) : null;
  return { inputs, change };
}

interface Bought {
  certificate: Record<string, unknown> & { id: string; payoutZat: string; askE4?: number };
  secret: string;
}

/** A trade at the live quote; a "price moved" refusal re-quotes and tries again, as the terminal does. */
async function buy(window: LaneWindow, asset: string): Promise<Bought & { side: "U" | "D" }> {
  for (let attempt = 1; ; attempt++) {
    const q = quote(window, asset);
    const side = q.up.askE4 !== null ? "U" : "D";
    const ask = (side === "U" ? q.up.askE4 : q.down.askE4) as number;
    const { inputs, change } = pay(STAKE);
    const secret = newSecret();
    const lock = createHash("sha256").update(Buffer.from(secret, "hex")).digest("hex");
    const request = {
      window: window.id,
      side,
      inputs,
      change: change?.outputs ?? [],
      maxAskE4: withSlippage(ask, DEFAULT_SLIPPAGE_BPS, "up"),
      lock,
    };
    const answer = await call("/v1/trade", request);
    if (answer.status !== 200 && answer.json.code === 20012 && attempt < 3) {
      chips.push(...inputs);
      console.log(`  re-quoting: ${answer.json.detail}`);
      continue;
    }
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    const certificate = answer.json.position;
    assert.ok(verifyDocument(certificate, operatorKey), "the certificate is signed by the operator");
    assert.equal(certificate.lock, lock);
    assert.equal(Number(certificate.payoutZat), sidePayoutZat(STAKE, certificate.askE4));
    if (change) chips.push(...finishOutputs(keyset, change, answer.json.change));
    const resent = await call("/v1/trade", request);
    assert.deepEqual(resent.json, answer.json, "a resent trade gets the same certificate (NUT-19)");
    return { certificate, secret, side };
  }
}

/* ── 1. Buy on a BTC 1-minute Window ────────────────────────────────────────────────────────────────────────── */
const oneMinute = await liveWindow("btc-1m", "BTC", 8);
const a = await buy(oneMinute, "BTC");
const b = await buy(oneMinute, "BTC");
await buy(oneMinute, "BTC");
step(
  `bought ${a.side} three times on ${oneMinute.id} at ${a.certificate.askE4}/10000 (pays ${a.certificate.payoutZat} zat on ${STAKE}); certificates signed, resends answered from the cache`,
);

/* ── 2. Close one early at the live bid ─────────────────────────────────────────────────────────────────────── */
{
  const q = quote(oneMinute, "BTC");
  const bid = (a.side === "U" ? q.up.bidE4 : q.down.bidE4) ?? 200;
  const outputs = prepareBlank(keyset, blankCount(keyset, Number(a.certificate.payoutZat)));
  const closed = await call("/v1/close", {
    position: a.certificate.id,
    secret: a.secret,
    minBidE4: withSlippage(bid, DEFAULT_SLIPPAGE_BPS, "down"),
    outputs: outputs.outputs,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  const value = Number(closed.json.valueZat);
  assert.equal(value, closeValueZat(Number(a.certificate.payoutZat), closed.json.bidE4));
  chips.push(...finishBlank(keyset, outputs, closed.json.signatures, value));
  const again = await call("/v1/close", { ...closed.body, minBidE4: 200 });
  assert.equal(again.json.code, 20016, "a closed position can't close twice");
  step(
    `closed early at the bid ${closed.json.bidE4}/10000 for ${value} zat, paid as chips on blank outputs (DLEQ checked)`,
  );
}

/* ── 3. Arm a trail on a BTC 5-minute Window and walk away ──────────────────────────────────────────────────── */
const fiveMinute = await liveWindow("btc-5m", "BTC", 90);
const c = await buy(fiveMinute, "BTC");
const trailOutputs = prepareBlank(keyset, blankCount(keyset, Number(c.certificate.payoutZat)));
const armed = await call("/v1/exit", {
  position: c.certificate.id,
  secret: c.secret,
  outputs: trailOutputs.outputs,
  trail: { bps: 1, slippageBps: 5_000 },
});
assert.equal(armed.status, 200, JSON.stringify(armed.json));
step(`armed a 0.01 % trail on ${fiveMinute.id}; the client now says nothing until it collects`);

/* ── 4. A parlay of the next BTC and ETH 5-minute Windows (pre-listed at one half each) ──────────────────────── */
{
  const btc = laneById("btc-5m");
  const eth = laneById("eth-5m");
  assert.ok(btc && eth);
  const [, nextBtc] = currentAndNext(btc, nowSec());
  const [, nextEth] = currentAndNext(eth, nowSec());
  const legs = [
    { askE4: quote(nextBtc, "BTC").up.askE4 as number, expirySec: nextBtc.expirySec },
    { askE4: quote(nextEth, "ETH").down.askE4 as number, expirySec: nextEth.expirySec },
  ];
  const price = parlayPriceE8(legs);
  assert.ok(price.ok);
  const { inputs, change } = pay(STAKE);
  const secret = newSecret();
  const answer = await call("/v1/parlay", {
    legs: [
      { window: nextBtc.id, side: "U" },
      { window: nextEth.id, side: "D" },
    ],
    inputs,
    change: change?.outputs ?? [],
    maxPriceE8: parlayWithSlippage(price.priceE8, DEFAULT_SLIPPAGE_BPS),
    lock: createHash("sha256").update(Buffer.from(secret, "hex")).digest("hex"),
  });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  assert.ok(verifyDocument(answer.json.position, operatorKey));
  assert.ok(answer.json.position.priceE8 <= parlayWithSlippage(price.priceE8, DEFAULT_SLIPPAGE_BPS));
  assert.equal(Number(answer.json.position.payoutZat), parlayPayoutZat(STAKE, answer.json.position.priceE8));
  if (change) chips.push(...finishOutputs(keyset, change, answer.json.change));
  const reused = await call("/v1/parlay", { ...answer.body, lock: "0".repeat(64) });
  assert.equal(reused.json.code, 11001, "the same chips can't buy twice");
  step(`parlay: BTC up × ETH down at ${price.priceE8}/10^8, pays ${answer.json.position.payoutZat} zat on ${STAKE}`);
}

/* ── 5. Let B settle, then redeem it ────────────────────────────────────────────────────────────────────────── */
{
  const outputs = prepareBlank(keyset, blankCount(keyset, Number(b.certificate.payoutZat)));
  let redeemed: Awaited<ReturnType<typeof call>> | null = null;
  while (!redeemed) {
    const attempt = await call("/v1/redeem", {
      position: b.certificate.id,
      secret: b.secret,
      outputs: outputs.outputs,
    });
    if (attempt.status === 200) redeemed = attempt;
    else {
      assert.equal(attempt.json.code, 20017, JSON.stringify(attempt.json));
      await sleep(3000);
    }
  }
  const value = Number(redeemed.json.valueZat);
  const outcome = bundle().windows.find((w) => w.id === oneMinute.id)?.outcome;
  const expected = outcome === b.side ? Number(b.certificate.payoutZat) : outcome === "refund" ? STAKE : 0;
  assert.equal(value, expected, `outcome ${outcome}`);
  chips.push(...finishBlank(keyset, outputs, redeemed.json.signatures, value));
  step(`${oneMinute.id} settled ${outcome}; redeemed ${b.side} for ${value} zat`);
  const volume = bundle().windows.find((w) => w.id === oneMinute.id);
  assert.equal(volume?.trades, 3, "three trades on the Window are published as one group");
  assert.equal(volume?.volumeZat, String(3 * STAKE));
  step("the bundle shows the Window's activity as a group of 3 trades, never one");
}

/* ── 6. Collect the trail's proceeds ────────────────────────────────────────────────────────────────────────── */
for (;;) {
  const position = await call("/v1/position", { position: c.certificate.id, secret: c.secret });
  assert.equal(position.status, 200, JSON.stringify(position.json));
  if (position.json.state !== "armed") {
    const value = Number(position.json.paidZat);
    chips.push(...finishBlank(keyset, trailOutputs, position.json.signatures, value));
    step(
      `the trail's position was ${position.json.how === "trail" ? "closed by the trail" : `paid (${position.json.how})`} with nobody watching: collected ${value} zat`,
    );
    break;
  }
  await sleep(2000);
}

const house = bundle().house;
step(`house book: ${house.chipsOutstandingZat} zat in chips outstanding, ${house.openMaxPayoutZat} zat most owed`);
console.log(`wallet now holds ${total(chips)} zat in ${chips.length} chips`);
socket.close();
