/**
 * Writes fixtures/signing.json: canonical JSON bytes, Ed25519 signatures, rules hashes and file hashes
 * computed by the reference packages (@kakure/signing, @noble/hashes) with a fixed TEST-ONLY secret.
 * The Rust operator's test (`src/signing.rs`) must reproduce every byte and signature (Ed25519 is deterministic).
 * Run: pnpm --filter @kakure/domain exec tsx scripts/signing-vectors.ts
 */
import { writeFileSync } from "node:fs";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJson, publicKeyFor, signDocument } from "../../signing/src/index";
import { RULES_HASH_PERSONAL } from "../src/constants";
import { toBase64Url, toHex, utf8 } from "../src/encoding";

/** A fixed, public test secret. Never used for anything but these fixtures. */
const SECRET = Uint8Array.from({ length: 32 }, (_, index) => (index * 7 + 3) % 256);

const rulesExample = {
  question: "BTC Up or Down: 2026-10-17 19:00 to 20:00 UTC",
  resolution: "2 of 3 venues vote on the 1-hour close against the opening reference.",
  sources: ["coinbase:BTC-USD", "kraken:XBTUSD", "bitstamp:btcusd"],
  cancellation: "Refund every ticket if either side has fewer than 3 tickets at the cutoff.",
  payoutFormula: "stake + round(stake × losing × 0.98 / winning, 0.001 ZEC)",
};

const documents: Array<{ name: string; document: Record<string, unknown> }> = [
  {
    name: "key order (UTF-16 code units, not code points)",
    document: {
      z: 1,
      a: 2,
      A: 3,
      "": 4,
      "10": 5,
      "9": 6,
      é: 7,
      "�": 8,
      "😀": 9,
      nested: { b: [3, { d: null, c: true }], a: false },
    },
  },
  {
    name: "string escapes",
    document: {
      text: 'quote" backslash\\ slash/ newline\n tab\t cr\r bs\b ff\f nul\u0000 unit\u001f del\u007f ls  ps ',
      unicode: "Kakure 隠れ é 😀",
    },
  },
  {
    name: "safe integers and literals",
    document: {
      zero: 0,
      negative: -1,
      max: Number.MAX_SAFE_INTEGER,
      min: -Number.MAX_SAFE_INTEGER,
      yes: true,
      no: false,
      none: null,
      empty: [],
      object: {},
      deep: [[[]], [{}]],
    },
  },
  {
    name: "latest.json",
    document: {
      v: 1,
      network: "testnet",
      seq: 42,
      bundle: "bundle-42.json",
      bundleHash: "0".repeat(64),
      publishedAt: "2026-10-17T19:00:30Z",
    },
  },
  {
    name: "addresses",
    document: {
      v: 1,
      network: "testnet",
      seq: 0,
      addresses: [
        "utest15a2u8lfvhtc8zuy9jh8mj7cawp7thxr0gjsyl9r4nqa7lrp7wrlcnaqpnenu0z92kzkf2j4j7e6qx6u507gl5wh9uvj95k45dv55vjgd",
      ],
    },
  },
  {
    name: "bundle",
    document: {
      v: 1,
      network: "testnet",
      seq: 7,
      publishedAt: "2026-10-17T19:10:30Z",
      previous: null,
      addresses: "addresses-0123abcd.json",
      payoutRuns: [],
      markets: [
        {
          id: "btc-1h-2610172000",
          kind: "close",
          subject: "BTC",
          window: "1h",
          opensAt: "2026-10-17T19:00:00Z",
          cutoffAt: "2026-10-17T19:50:00Z",
          closesAt: "2026-10-17T20:00:00Z",
          rules: rulesExample,
          rulesHash: "f".repeat(64),
          opening: { coinbase: "81150.47", kraken: "81160.1", bitstamp: "81152" },
          state: "open",
          sealed: false,
          ticketCount: 6,
          released: { seq: 7, sides: { U: { tickets: 3, zat: "3000000" }, D: { tickets: 3, zat: "5000000" } } },
          leaves: ["a".repeat(64), "b".repeat(64)],
        },
      ],
    },
  },
];

const signed = documents.map(({ name, document }) => {
  const { sig } = signDocument(document, SECRET);
  return { name, document, canonical: canonicalJson(document), sig };
});

const rulesHashes = [rulesExample, { ...rulesExample, sources: ["chain:testnet"] }].map((rules) => ({
  rules,
  rulesHash: toHex(
    blake2b(utf8.encode(canonicalJson(rules)), { dkLen: 32, personalization: utf8.encode(RULES_HASH_PERSONAL) }),
  ),
}));

const fileHashes = signed.map(({ document, sig }) => {
  const text = canonicalJson({ ...document, sig });
  return { text, sha256: toHex(sha256(utf8.encode(text))) };
});

const publicKey = publicKeyFor(SECRET);
const fixtures = {
  note: "TEST-ONLY secret; never used outside these fixtures",
  secretKeyHex: toHex(SECRET),
  publicKeyHex: toHex(publicKey),
  publicKeyBase64Url: toBase64Url(publicKey),
  documents: signed,
  rulesHashes,
  fileHashes,
};

const target = new URL("../fixtures/signing.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(
  `wrote ${signed.length} signed documents, ${rulesHashes.length} rules hashes, ${fileHashes.length} file hashes`,
);
