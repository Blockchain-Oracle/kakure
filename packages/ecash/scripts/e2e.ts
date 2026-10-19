/**
 * End to end against a running operator: this package's wallet ↔ the operator's mint (the `cashu` crate), every call
 * through the Oblivious HTTP gateway (@kakure/ohttp). Reads the signed bundle from <public dir> for the keyset and the
 * gateway key, as a browser does. Needs a confirmed deposit id on that operator.
 * Usage: pnpm --filter @kakure/ecash e2e <public/<network> dir> <gateway origin> <deposit id> <testnet payout address>
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { obliviousFetch } from "@kakure/ohttp";
import { checkKeyset, chipY, finishOutputs, type Keyset, type Proof, prepareOutputs, total } from "../src";

const [dir, gateway, deposit, address] = process.argv.slice(2);
if (!dir || !gateway || !deposit || !address) throw new Error("usage: e2e <dir> <gateway> <deposit id> <address>");
const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
const bundle = JSON.parse(readFileSync(join(dir, latest.bundle), "utf8"));
const keyset: Keyset = bundle.trading.keyset;
const oblivious = {
  relay: `${gateway}/gateway`,
  keyConfig: new Uint8Array(Buffer.from(bundle.trading.gatewayKeys, "base64url")),
};

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await obliviousFetch(oblivious, method, path, body);
  return { status: response.status, json: await response.json() };
}
const step = (name: string) => console.log(`✓ ${name}`);

assert.equal(checkKeyset(keyset), true, "the bundle's keyset id is what its keys hash to");
const keys = await call("GET", "/v1/keys");
assert.deepEqual(keys.json.keysets[0], keyset);
step(`keyset ${keyset.id.slice(0, 12)}… in the bundle = /v1/keys, and its id recomputes`);

const state = await call("GET", `/v1/deposit/${deposit}`);
const mintable = Number(state.json.mintableZat);
assert.ok(mintable > 0, `deposit not mintable: ${JSON.stringify(state.json)}`);
step(
  `deposit ${state.json.state}, ${mintable} zat mintable (${state.json.confirmations}/${state.json.needed} confirmations)`,
);

const greedy = prepareOutputs(keyset, mintable + 100_000);
const tooMuch = await call("POST", "/v1/mint/zcash", { deposit, outputs: greedy.outputs });
assert.equal(tooMuch.status, 400);
assert.equal(tooMuch.json.code, 20001);
step("minting more than the deposit is refused");

const pending = prepareOutputs(keyset, mintable);
const minted = await call("POST", "/v1/mint/zcash", { deposit, outputs: pending.outputs });
assert.equal(minted.status, 200, JSON.stringify(minted.json));
let chips: Proof[] = finishOutputs(keyset, pending, minted.json.signatures);
assert.equal(total(chips), mintable);
step(`minted ${chips.length} chips worth ${total(chips)} zat, every DLEQ checked`);

const resent = await call("POST", "/v1/mint/zcash", { deposit, outputs: pending.outputs });
assert.equal(resent.status, 200);
assert.deepEqual(resent.json.signatures, minted.json.signatures);
step("resending the same mint request returns the same signatures (NUT-19): a lost answer loses nothing");

const again = await call("POST", "/v1/mint/zcash", { deposit, outputs: prepareOutputs(keyset, 100_000).outputs });
assert.equal(again.status, 400);
step("the same deposit can't mint twice");

const fresh = prepareOutputs(keyset, total(chips));
const swapped = await call("POST", "/v1/swap", { inputs: chips, outputs: fresh.outputs });
assert.equal(swapped.status, 200, JSON.stringify(swapped.json));
const old = chips;
chips = finishOutputs(keyset, fresh, swapped.json.signatures);
const states = await call("POST", "/v1/checkstate", { Ys: [...old, ...chips].map(chipY) });
assert.ok(states.json.states.slice(0, old.length).every((s: { state: string }) => s.state === "SPENT"));
assert.ok(states.json.states.slice(old.length).every((s: { state: string }) => s.state === "UNSPENT"));
step("swap: the old chips are spent, the new ones unspent (NUT-07)");

const doubleSpend = await call("POST", "/v1/swap", {
  inputs: old,
  outputs: prepareOutputs(keyset, total(old)).outputs,
});
assert.equal(doubleSpend.status, 400);
assert.equal(doubleSpend.json.code, 11001);
step("spending the old chips again is refused (already spent)");

const smallest = [...chips].sort((a, b) => a.amount - b.amount)[0];
assert.ok(smallest);
if (smallest.amount < 1_000_000) {
  const dust = await call("POST", "/v1/melt/zcash", { inputs: [smallest], address });
  assert.equal(dust.status, 400);
  step("a withdrawal under 0.01 is refused");
}
const melt = await call("POST", "/v1/melt/zcash", { inputs: chips, address });
assert.equal(melt.status, 200, JSON.stringify(melt.json));
step(`withdrawal of ${melt.json.amountZat} zat scheduled within ${melt.json.withinSecs} s`);
console.log("✓ the browser wallet and the operator's mint agree end to end");
