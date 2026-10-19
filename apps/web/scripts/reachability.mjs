/**
 * Reachability gate (Mitoshi's route-coverage contract, mitoshi-code-study.md §1.2): every page under src/app has a
 * home in the rail, the More drawer or the brand mark, and every internal link in the registry opens a page that
 * exists. Reads the registry itself (src/features/shell/places.ts; Node strips its types). Exit code 1 on a miss.
 *
 * Usage: `node scripts/reachability.mjs` (also the first step of `pnpm build`).
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homeOf, MORE_ITEMS, PLACES } from "../src/features/shell/places.ts";

const APP_DIR = fileURLToPath(new URL("../src/app/", import.meta.url));
const ROUTE_GROUP = /^\(.+\)$/;

function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* pages(path);
    else if (name === "page.tsx") yield path;
  }
}

/** `src/app/(app)/markets/page.tsx` → `/markets`; route groups add no segment. */
function routeOf(file) {
  const segments = relative(APP_DIR, file).split(sep).slice(0, -1);
  return `/${segments.filter((segment) => !ROUTE_GROUP.test(segment)).join("/")}`;
}

const routes = [...pages(APP_DIR)].map(routeOf).sort();
const problems = [];

for (const route of routes) {
  const home = homeOf(route);
  if (home) console.log(`  ${route.padEnd(14)} ${home}`);
  else problems.push(`${route} has no home in the rail or More (add it to src/features/shell/places.ts)`);
}

for (const entry of [...PLACES, ...MORE_ITEMS]) {
  if (entry.external) continue;
  const path = entry.href.split(/[?#]/)[0];
  if (!routes.includes(path)) problems.push(`${entry.name} links ${entry.href}, which is no page in src/app`);
}

if (problems.length > 0) {
  console.error(`Reachability FAILED (${problems.length}):\n${problems.map((line) => `  ✗ ${line}`).join("\n")}`);
  process.exit(1);
}
console.log(`Reachability passed: ${routes.length} pages, each with a home; every registry link opens a page.`);
