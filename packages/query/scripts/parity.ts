/**
 * Proves the zod/mini schemas in src/schemas.ts accept and reject exactly what @kakure/domain's schemas do.
 * Runs both over every published file it finds (operator output) plus mutated copies of each.
 * Run: pnpm --filter @kakure/query parity [dir with <network>/<file>.json …]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as full from "../../domain/src/bundle";
import * as mini from "../src/schemas";

const DEFAULT_DIR = new URL("../../../services/operator/operator-data/testnet/public", import.meta.url).pathname;
const dirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [DEFAULT_DIR];

type Kind = "latest" | "bundle" | "addresses" | "resolution";
const pick = (file: string): Kind | null =>
  file === "latest.json"
    ? "latest"
    : file.startsWith("bundle-")
      ? "bundle"
      : file.startsWith("addresses")
        ? "addresses"
        : file.startsWith("resolution-")
          ? "resolution"
          : null;
const schemas = {
  latest: [full.latestSchema, mini.latestSchema],
  bundle: [full.bundleSchema, mini.bundleSchema],
  addresses: [full.addressListSchema, mini.addressListSchema],
  resolution: [full.resolutionSchema, mini.resolutionSchema],
} as const;

/** Mutations that must be rejected (or accepted) identically by both. */
function mutations(doc: Record<string, unknown>): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [["as published", doc]];
  for (const key of Object.keys(doc)) {
    const { [key]: _drop, ...without } = doc;
    out.push([`without ${key}`, without]);
    out.push([`${key} = null`, { ...doc, [key]: null }]);
    out.push([`${key} = ""`, { ...doc, [key]: "" }]);
    out.push([`${key} = -1`, { ...doc, [key]: -1 }]);
  }
  out.push(["extra field", { ...doc, extra: 1 }]);
  const markets = doc.markets;
  if (Array.isArray(markets) && markets[0]) {
    const first = markets[0] as Record<string, unknown>;
    for (const key of Object.keys(first)) {
      out.push([`market.${key} = 1.5`, { ...doc, markets: [{ ...first, [key]: 1.5 }] }]);
      out.push([`market.${key} = "x"`, { ...doc, markets: [{ ...first, [key]: "x" }] }]);
    }
    out.push([
      "released U/D only",
      {
        ...doc,
        markets: [
          {
            ...first,
            released: { seq: 1, sides: { U: { tickets: 3, zat: "3000000" }, D: { tickets: 3, zat: "1000000" } } },
          },
        ],
      },
    ]);
    out.push([
      "released bad side",
      { ...doc, markets: [{ ...first, released: { seq: 1, sides: { X: { tickets: 3, zat: "1" } } } }] },
    ]);
  }
  return out;
}

let checked = 0;
const mismatches: string[] = [];
for (const dir of dirs) {
  for (const network of readdirSync(dir)) {
    for (const file of readdirSync(join(dir, network))) {
      const kind = pick(file);
      if (!kind) continue;
      const doc = JSON.parse(readFileSync(join(dir, network, file), "utf8")) as Record<string, unknown>;
      const [a, b] = schemas[kind];
      for (const [label, value] of mutations(doc)) {
        const fullOk = a.safeParse(value).success;
        const miniOk = b.safeParse(value).success;
        checked += 1;
        if (fullOk !== miniOk) mismatches.push(`${network}/${file} (${label}): domain ${fullOk}, mini ${miniOk}`);
      }
    }
  }
}
if (mismatches.length > 0) {
  console.error(`Schema parity FAILED on ${mismatches.length} of ${checked} cases:`);
  for (const line of mismatches) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log(`Schema parity: zod/mini and @kakure/domain agree on all ${checked} cases.`);
