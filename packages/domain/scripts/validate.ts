/**
 * Validates a directory of published operator files (`operator-data/<net>/public/<net>`):
 * every file parses with the frozen zod schemas, every signature verifies with the pinned public key,
 * files are canonical JSON, hashes chain (latest → bundle → previous), rules hashes and address-list
 * names match their content, and each market's leaves are sorted, unique and match ticketCount.
 * Run: pnpm --filter @kakure/domain exec tsx scripts/validate.ts <public-dir> <pubkey-hex>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJson, verifyDocument } from "../../signing/src/index";
import { addressListSchema, bundleSchema, latestSchema } from "../src/bundle";
import { ADDRESS_LIST_SIZE, RULES_HASH_PERSONAL } from "../src/constants";
import { toHex, utf8 } from "../src/encoding";

const [dir, pubkeyHex] = process.argv.slice(2);
if (!dir || !pubkeyHex || !/^[0-9a-f]{64}$/.test(pubkeyHex)) {
  console.error("usage: validate.ts <public-dir> <pubkey-hex>");
  process.exit(2);
}
const publicKey = Uint8Array.from(pubkeyHex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

const failures: string[] = [];
const fail = (file: string, message: string) => failures.push(`${file}: ${message}`);

interface Loaded {
  bytes: Uint8Array;
  json: Record<string, unknown>;
  hash: string;
}

function load(file: string): Loaded | undefined {
  try {
    const bytes = readFileSync(join(dir as string, file));
    const text = utf8.decode(bytes);
    const json = JSON.parse(text) as Record<string, unknown>;
    if (canonicalJson(json) !== text) {
      fail(file, "file is not the canonical JSON of its document");
    }
    if (!verifyDocument(json, publicKey)) {
      fail(file, "signature does not verify");
    }
    return { bytes, json, hash: toHex(sha256(bytes)) };
  } catch (error) {
    fail(file, `unreadable: ${(error as Error).message}`);
    return undefined;
  }
}

const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
const bundleFiles = files
  .filter((name) => /^bundle-\d+\.json$/.test(name))
  .sort((a, b) => Number(a.slice(7, -5)) - Number(b.slice(7, -5)));
const addressFiles = files.filter((name) => /^addresses-[0-9a-f]{8}\.json$/.test(name));

const bundleHashes = new Map<string, string>();
let marketCount = 0;
let leafCount = 0;

for (const file of addressFiles) {
  const loaded = load(file);
  if (!loaded) continue;
  const parsed = addressListSchema.safeParse(loaded.json);
  if (!parsed.success) {
    fail(file, `schema: ${parsed.error.message}`);
    continue;
  }
  if (!file.includes(loaded.hash.slice(0, 8))) {
    fail(file, `name does not match SHA-256 ${loaded.hash.slice(0, 8)}`);
  }
  const { addresses, network } = parsed.data;
  if (addresses.length !== ADDRESS_LIST_SIZE) {
    fail(file, `${addresses.length} addresses, expected ${ADDRESS_LIST_SIZE}`);
  }
  if (new Set(addresses).size !== addresses.length) {
    fail(file, "duplicate addresses");
  }
  const prefix = network === "testnet" ? "utest1" : "u1";
  if (addresses.some((address) => !address.startsWith(prefix))) {
    fail(file, `an address is not a ${network} Unified Address`);
  }
}

let previousHash: string | null = null;
for (const [position, file] of bundleFiles.entries()) {
  const loaded = load(file);
  if (!loaded) continue;
  bundleHashes.set(file, loaded.hash);
  const parsed = bundleSchema.safeParse(loaded.json);
  if (!parsed.success) {
    fail(file, `schema: ${parsed.error.message}`);
    continue;
  }
  const bundle = parsed.data;
  if (`bundle-${bundle.seq}.json` !== file) {
    fail(file, `seq ${bundle.seq} does not match the file name`);
  }
  if (position > 0 && bundle.previous !== previousHash) {
    fail(file, "previous does not chain to the prior bundle");
  }
  previousHash = loaded.hash;
  if (!files.includes(bundle.addresses)) {
    fail(file, `address list ${bundle.addresses} is missing`);
  }
  for (const market of bundle.markets) {
    marketCount += 1;
    leafCount += market.leaves.length;
    const expected = toHex(
      blake2b(utf8.encode(canonicalJson(market.rules)), {
        dkLen: 32,
        personalization: utf8.encode(RULES_HASH_PERSONAL),
      }),
    );
    if (market.rulesHash !== expected) {
      fail(file, `${market.id}: rulesHash does not match its rules`);
    }
    const sorted = [...market.leaves].sort();
    if (market.leaves.some((leaf, index) => leaf !== sorted[index]) || new Set(sorted).size !== sorted.length) {
      fail(file, `${market.id}: leaves are not sorted and unique`);
    }
    if (market.ticketCount !== market.leaves.length) {
      fail(file, `${market.id}: ticketCount ${market.ticketCount} ≠ ${market.leaves.length} leaves`);
    }
    if (market.kind === "close" && market.state === "open" && Object.keys(market.opening ?? {}).length < 2) {
      fail(file, `${market.id}: open without an opening reference from 2 venues`);
    }
  }
}

const latest = load("latest.json");
if (latest) {
  const parsed = latestSchema.safeParse(latest.json);
  if (!parsed.success) {
    fail("latest.json", `schema: ${parsed.error.message}`);
  } else if (bundleHashes.get(parsed.data.bundle) !== parsed.data.bundleHash) {
    fail("latest.json", `bundleHash does not match ${parsed.data.bundle}`);
  }
}

console.log(
  `${bundleFiles.length} bundles, ${addressFiles.length} address lists, latest.json; ` +
    `${marketCount} market entries, ${leafCount} leaves`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK: every file parses, is canonical, verifies and chains");
