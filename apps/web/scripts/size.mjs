/**
 * JS budget check for the static export (plan §2 Budgets): our own JS on the landing (/) and on /markets
 * ≤ 35 KB gzipped each, plus the framework (React + Next runtime, ceiling 130 KB).
 *
 * Usage: `pnpm --filter @kakure/web size` (builds with source maps, measures, removes the maps).
 *        `node scripts/size.mjs --no-build` measures an existing `out/`.
 *
 * It reads every script `out/<route>.html` loads (module scripts only; the legacy `noModule` polyfill is excluded),
 * gzips each chunk, and splits the bytes by source with the chunk's source map:
 *   - framework: react, react-dom, next, scheduler and Turbopack's runtime
 *   - libraries: every other node_modules package (zod, TanStack Query, noble, lucide…)
 *   - ours: apps/web and packages/* (the code written for Kakure)
 * Gzipped bytes are shared out in proportion to each source's raw bytes in the chunk.
 * Exit code 1 when ours exceeds the budget.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const APP = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(APP, "out");
/** `index` is the landing page; /m is measured for reference (it adds the bet sheet). */
const ROUTES = ["index", "markets", "m"];
const BUDGETED = new Set(["index", "markets"]);
const BUDGET_OURS_KB = 35;
const BUDGET_FRAMEWORK_KB = 130;
const KB = 1024;
const GZIP_LEVEL = 9;
const FRAMEWORK =
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(react|react-dom|next|scheduler|@next|@swc\/helpers)\//;
const LIBRARY = /node_modules\//;

if (!process.argv.includes("--no-build")) {
  execFileSync("pnpm", ["exec", "next", "build"], {
    cwd: APP,
    stdio: "inherit",
    env: { ...process.env, KAKURE_SOURCE_MAPS: "1" },
  });
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = Object.fromEntries([...BASE64].map((char, i) => [char, i]));
const VLQ_SHIFT = 5;
const VLQ_CONTINUE = 32;
const VLQ_MASK = 31;

function decodeSegment(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = DIGIT[char];
    value += (digit & VLQ_MASK) << shift;
    if (digit & VLQ_CONTINUE) {
      shift += VLQ_SHIFT;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

/** Raw bytes per source for one chunk, from its source map (lines × columns → source index). */
function bytesBySource(code, map) {
  const lines = code.split("\n");
  const totals = new Map();
  let source = 0;
  map.mappings.split(";").forEach((line, lineIndex) => {
    const text = lines[lineIndex] ?? "";
    let column = 0;
    let previous = null;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const [columnDelta, sourceDelta] = decodeSegment(segment);
      column += columnDelta;
      if (previous) totals.set(previous.source, (totals.get(previous.source) ?? 0) + (column - previous.column));
      if (sourceDelta !== undefined) {
        source += sourceDelta;
        previous = { source, column };
      } else {
        previous = { source: -1, column };
      }
    }
    if (previous) totals.set(previous.source, (totals.get(previous.source) ?? 0) + (text.length - previous.column));
  });
  return new Map([...totals].map(([index, bytes]) => [map.sources[index] ?? "(unmapped)", bytes]));
}

function bucketOf(source) {
  // Turbopack's runtime and other virtual modules live outside [project]/.
  if (!source.includes("[project]/")) return "framework";
  if (FRAMEWORK.test(source)) return "framework";
  if (LIBRARY.test(source)) return "libraries";
  return "ours";
}

function packageOf(source) {
  const match = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(source);
  if (match) return match[1];
  const workspace = /\[project\]\/((?:apps|packages)\/[^/]+)/.exec(source);
  return workspace ? workspace[1] : source;
}

function measureRoute(route) {
  const html = readFileSync(join(OUT, `${route}.html`), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"([^>]*)>/g)]
    .filter(([, , attributes]) => !/nomodule/i.test(attributes))
    .map(([, src]) => src);
  const buckets = { framework: 0, libraries: 0, ours: 0 };
  const packages = new Map();
  let mapped = true;
  for (const src of new Set(scripts)) {
    const file = join(OUT, src);
    const code = readFileSync(file, "utf8");
    const gzipped = gzipSync(code, { level: GZIP_LEVEL }).length;
    const mapName = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code)?.[1];
    const mapFile = mapName ? join(OUT, "_next/static/chunks", mapName) : null;
    if (!mapFile || !existsSync(mapFile)) {
      mapped = false;
      buckets.framework += gzipped;
      continue;
    }
    const sources = bytesBySource(code, JSON.parse(readFileSync(mapFile, "utf8")));
    const raw = [...sources.values()].reduce((sum, bytes) => sum + bytes, 0) || 1;
    for (const [source, bytes] of sources) {
      const share = (gzipped * bytes) / raw;
      const bucket = bucketOf(source);
      buckets[bucket] += share;
      if (bucket !== "framework") {
        const name = packageOf(source);
        packages.set(name, (packages.get(name) ?? 0) + share);
      }
    }
  }
  return { route, scripts: scripts.length, buckets, packages, mapped };
}

const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;
let failed = false;
for (const route of ROUTES) {
  const { scripts, buckets, packages, mapped } = measureRoute(route);
  const total = buckets.framework + buckets.libraries + buckets.ours;
  const path = route === "index" ? "/" : `/${route}`;
  console.log(`\n${path}: ${scripts} scripts, ${kb(total)} gzipped`);
  console.log(`  framework  ${kb(buckets.framework).padStart(9)}  (ceiling ${BUDGET_FRAMEWORK_KB} KB)`);
  console.log(`  libraries  ${kb(buckets.libraries).padStart(9)}`);
  console.log(`  ours       ${kb(buckets.ours).padStart(9)}  (budget ${BUDGET_OURS_KB} KB)`);
  const top = [...packages].sort((a, b) => b[1] - a[1]);
  console.log(`  by package: ${top.map(([name, bytes]) => `${name} ${kb(bytes)}`).join(", ")}`);
  if (!mapped) console.log("  (some chunks had no source map; their bytes are counted as framework)");
  if (BUDGETED.has(route) && buckets.ours > BUDGET_OURS_KB * KB) {
    console.error(`  ✗ our JS on ${path} is over the ${BUDGET_OURS_KB} KB budget`);
    failed = true;
  }
  if (BUDGETED.has(route) && buckets.framework > BUDGET_FRAMEWORK_KB * KB) {
    console.warn(`  ! the framework is over its ${BUDGET_FRAMEWORK_KB} KB ceiling`);
  }
}

// Source maps are for measuring only; the deployed export ships without them.
for (const file of readdirSync(join(OUT, "_next/static/chunks"))) {
  if (file.endsWith(".map")) rmSync(join(OUT, "_next/static/chunks", file));
}
process.exit(failed ? 1 : 0);
