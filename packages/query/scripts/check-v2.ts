/**
 * Checks a directory of real-time public files (plan §00, version 2) the way a browser does: the operator's signature
 * over each document, then the frozen schema, then every settled Window's reference and outcome recomputed from its
 * signed prints (@kakure/domain settle.ts). Exit 1 on any failure.
 *
 * Usage: pnpm --filter @kakure/query check-v2 <public/<network> dir> <operator public key hex>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bundleV2Schema,
  latestV2Schema,
  outcomeOf,
  printsSchema,
  referenceOf,
  type VenueKey,
  type WindowState,
} from "@kakure/domain";
import { verifyDocument } from "@kakure/signing";

const [dir, keyHex] = process.argv.slice(2);
if (!dir || !keyHex) throw new Error("usage: check-v2 <dir> <public key hex>");
const key = Uint8Array.from((keyHex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error(`✗ ${message}`);
}

function recompute(windows: readonly WindowState[], venues: Map<string, readonly VenueKey[]>) {
  let checked = 0;
  for (const window of windows.filter((w) => w.outcome)) {
    const lane = venues.get(window.id.slice(0, window.id.lastIndexOf("-")));
    if (!lane) {
      fail(`${window.id}: unknown lane`);
      continue;
    }
    const reference = referenceOf(lane, window.opening ?? {});
    const outcome = reference === null ? "refund" : outcomeOf(lane, window.opening ?? {}, window.closing ?? {});
    if (outcome !== window.outcome || (reference ?? undefined) !== window.reference) {
      fail(`${window.id}: published ${window.outcome}/${window.reference}, recomputed ${outcome}/${reference}`);
    }
    checked += 1;
  }
  return checked;
}

const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
if (!verifyDocument(latest, key)) fail("latest.json: bad signature");
if (!latestV2Schema.safeParse(latest).success) fail("latest.json: schema");
const bundle = JSON.parse(readFileSync(join(dir, latest.bundle), "utf8"));
if (!verifyDocument(bundle, key)) fail(`${latest.bundle}: bad signature`);
const parsed = bundleV2Schema.safeParse(bundle);
if (!parsed.success) {
  fail(`${latest.bundle}: schema ${parsed.error.message.slice(0, 600)}`);
} else {
  const venues = new Map(parsed.data.lanes.map((lane) => [lane.id, lane.venues]));
  const checked = recompute(parsed.data.windows, venues);
  console.log(
    `${latest.bundle}: ${parsed.data.lanes.length} lanes, ${parsed.data.windows.length} windows, ${checked} settled recomputed, σ ${JSON.stringify(parsed.data.pricing.sigma)}`,
  );
  for (const name of readdirSync(dir).filter((f) => f.startsWith("prints-"))) {
    const prints = JSON.parse(readFileSync(join(dir, name), "utf8"));
    if (!verifyDocument(prints, key)) fail(`${name}: bad signature`);
    const p = printsSchema.safeParse(prints);
    if (!p.success) fail(`${name}: schema ${p.error.message.slice(0, 300)}`);
    else console.log(`${name}: ${recompute(p.data.windows, venues)} settled recomputed`);
  }
}
if (failures > 0) process.exit(1);
console.log("✓ every file is signed, valid and recomputes");
