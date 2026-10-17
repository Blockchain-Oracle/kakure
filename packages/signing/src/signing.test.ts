import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, publicKeyFor, signDocument, verifyDocument } from "./index";

const SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PUBLIC = publicKeyFor(SECRET);

describe("canonical JSON", () => {
  it("sorts keys at every depth and drops undefined", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [2, { z: "x", y: null }], c: true }, e: undefined }),
      '{"a":{"c":true,"d":[2,{"y":null,"z":"x"}]},"b":1}',
    );
  });

  it("refuses floats and unsafe integers (amounts travel as strings)", () => {
    assert.throws(() => canonicalJson({ amount: 0.1 }));
    assert.throws(() => canonicalJson({ amount: Number.MAX_SAFE_INTEGER + 1 }));
  });
});

describe("Ed25519 documents", () => {
  const document = { v: 1, network: "testnet", seq: 7, markets: [{ id: "btc-1h-2610171600", ticketCount: 4 }] };

  it("verifies its own signature regardless of key order", () => {
    const signed = signDocument(document, SECRET);
    const reordered = {
      markets: signed.markets,
      sig: signed.sig,
      seq: signed.seq,
      network: signed.network,
      v: signed.v,
    };
    assert.ok(verifyDocument(reordered, PUBLIC));
  });

  it("rejects any change to the content, a wrong key and a missing signature", () => {
    const signed = signDocument(document, SECRET);
    assert.equal(verifyDocument({ ...signed, seq: 8 }, PUBLIC), false);
    assert.equal(verifyDocument(signed, publicKeyFor(Uint8Array.from({ length: 32 }, () => 9))), false);
    assert.equal(verifyDocument(document, PUBLIC), false);
  });
});
