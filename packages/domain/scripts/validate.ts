/**
 * Validates a directory of published operator files (`operator-data/<net>/public/<net>`):
 * every file parses with the frozen zod schemas, every signature verifies with the pinned public key,
 * files are canonical JSON, hashes chain (latest → bundle → previous), rules hashes and address-list
 * names match their content, and each market's leaves are sorted, unique and match ticketCount.
 * Markets whose rules carry the release rule (PD28) are also checked across bundles: their count and leaves change
 * only by releases of at least MIN_NEW_TICKETS_PER_RELEASE new tickets, and the released totals describe that set.
 * Run: pnpm --filter @kakure/domain exec tsx scripts/validate.ts <public-dir> <pubkey-hex>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJson, verifyDocument } from "../../signing/src/index";
import { addressListSchema, bundleSchema, historySchema, latestSchema, resolutionSchema } from "../src/bundle";
import { ADDRESS_LIST_SIZE, MIN_NEW_TICKETS_PER_RELEASE, RULES_HASH_PERSONAL } from "../src/constants";
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
const resolutionFiles = files.filter((name) => /^resolution-[a-z0-9-]+\.json$/.test(name));
const historyFiles = files.filter((name) => /^history-\d{8}\.json$/.test(name));
const resolutions = new Map<string, { outcome: string; rulesHash: string }>();
const listSizes = new Map<string, number>();
let currentList = "";

for (const file of resolutionFiles) {
  const loaded = load(file);
  if (!loaded) continue;
  const parsed = resolutionSchema.safeParse(loaded.json);
  if (!parsed.success) {
    fail(file, `schema: ${parsed.error.message}`);
    continue;
  }
  const doc = parsed.data;
  if (file !== `resolution-${doc.market}.json`) fail(file, "name does not match its market");
  // A cancelled close market (fewer than 2 opening references) never votes: it refunds every ticket.
  if (doc.reason === "cancelled") {
    if (doc.outcome !== "refund" || doc.direction !== "none" || (doc.votes?.length ?? 0) > 0) {
      fail(file, "a cancelled market must refund, with no direction and no votes");
    }
  } else if (doc.kind === "close" && (doc.votes?.length ?? 0) !== 3) {
    fail(file, "a close market needs 3 venue votes");
  }
  if (doc.kind === "event" && !doc.chain) fail(file, "an event market needs its chain read");
  const ups = doc.votes?.filter((vote) => vote.vote === "U").length ?? 0;
  const downs = doc.votes?.filter((vote) => vote.vote === "D").length ?? 0;
  if (doc.kind === "close") {
    const direction = ups >= 2 ? "U" : downs >= 2 ? "D" : "none";
    if (direction !== doc.direction) fail(file, `votes say ${direction}, file says ${doc.direction}`);
  }
  const thin = Object.values(doc.totals).some((side) => side.tickets < 3);
  if (thin && doc.outcome !== "refund") fail(file, "a thin pool must refund");
  resolutions.set(file, { outcome: doc.outcome, rulesHash: doc.rulesHash });
}

for (const file of historyFiles) {
  const loaded = load(file);
  if (!loaded) continue;
  const parsed = historySchema.safeParse(loaded.json);
  if (!parsed.success) {
    fail(file, `schema: ${parsed.error.message}`);
    continue;
  }
  if (file !== `history-${parsed.data.day.replaceAll("-", "")}.json`) fail(file, "name does not match its day");
  for (const market of parsed.data.markets) {
    const times = market.closes.map(([time]) => time);
    if (times.some((time, index) => index > 0 && time <= (times[index - 1] ?? 0))) {
      fail(file, `${market.id}: closes are not in time order`);
    }
  }
  console.log(`${file}: ${parsed.data.markets.length} markets, ${loaded.bytes.length} bytes`);
}

const bundleHashes = new Map<string, string>();
let marketCount = 0;
let leafCount = 0;
/** Wording every market created under PD28 carries in its cancellation rules. */
const RELEASE_RULE = "published only in releases of at least";
const lastSeen = new Map<string, { count: number; leaves: Set<string> }>();
let releaseChecked = 0;

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
  listSizes.set(file, addresses.length);
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
  currentList = bundle.addresses;
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
    if (market.rules.cancellation.includes(RELEASE_RULE)) {
      releaseChecked += 1;
      const released = Object.values(market.released?.sides ?? {}).reduce((sum, side) => sum + side.tickets, 0);
      if (market.released && released !== market.ticketCount) {
        fail(file, `${market.id}: released totals count ${released} tickets, ticketCount is ${market.ticketCount}`);
      }
      const before = lastSeen.get(market.id) ?? { count: 0, leaves: new Set<string>() };
      const added = market.ticketCount - before.count;
      const kept = [...before.leaves].every((leaf) => market.leaves.includes(leaf));
      if (added > 0 && (added < MIN_NEW_TICKETS_PER_RELEASE || !kept)) {
        fail(file, `${market.id}: ${added} new ticket(s) published (a release needs ${MIN_NEW_TICKETS_PER_RELEASE})`);
      }
      if (added === 0 && !kept) fail(file, `${market.id}: leaves changed without a release`);
      // A count only drops at the freeze, when a reorg removed a released ticket's payment.
      if (added < 0 && market.cutoffHeight === undefined) fail(file, `${market.id}: ticketCount went down`);
      if (added !== 0 && market.released && market.released.seq !== bundle.seq) {
        fail(file, `${market.id}: released.seq ${market.released.seq} is not this release's bundle`);
      }
      lastSeen.set(market.id, { count: market.ticketCount, leaves: new Set(market.leaves) });
    }
    if (market.kind === "close" && market.state === "open" && Object.keys(market.opening ?? {}).length < 2) {
      fail(file, `${market.id}: open without an opening reference from 2 venues`);
    }
    if (market.resolution) {
      const evidence = resolutions.get(market.resolution);
      if (!evidence) {
        fail(file, `${market.id}: ${market.resolution} is missing or invalid`);
      } else if (evidence.outcome !== market.outcome || evidence.rulesHash !== market.rulesHash) {
        fail(file, `${market.id}: outcome or rules hash differ from ${market.resolution}`);
      }
    }
  }
  for (const day of bundle.history ?? []) {
    if (!files.includes(day)) fail(file, `history file ${day} is missing`);
  }
}

// Older lists may predate a size change; the one in force must have exactly ADDRESS_LIST_SIZE.
if (listSizes.has(currentList) && listSizes.get(currentList) !== ADDRESS_LIST_SIZE) {
  fail(currentList, `${listSizes.get(currentList)} addresses, expected ${ADDRESS_LIST_SIZE}`);
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
  `${bundleFiles.length} bundles, ${addressFiles.length} address lists, ${resolutionFiles.length} resolutions, ` +
    `${historyFiles.length} history days, latest.json; ${marketCount} market entries, ${leafCount} leaves; ` +
    `${releaseChecked} entries under the release rule checked`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK: every file parses, is canonical, verifies and chains");
