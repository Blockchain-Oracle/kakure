/**
 * Runs after `next build`: writes out/sw.js from scripts/sw.js with what to precache and a version hashed from the
 * pages and the search index (a new deploy replaces the old cache; an unchanged one keeps it). Precached:
 *   - every exported page, and the scripts, styles and fonts those pages load, so any page hydrates offline;
 *   - the chunks those scripts load lazily, group by group, when a group is small: that keeps the search engine
 *     (~64 KB, loaded when the search dialog opens) and leaves out the Mermaid renderer (~670 KB, fetched and kept
 *     the first time System maps is opened).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const SOURCE = fileURLToPath(new URL("./sw.js", import.meta.url));
const VERSION_LENGTH = 12;
const SKIP = new Set(["404.html", "_not-found.html"]);

const pages = readdirSync(OUT)
  .filter((name) => name.endsWith(".html") && !SKIP.has(name))
  .map((name) => (name === "index.html" ? "/" : `/${name.slice(0, -".html".length)}`))
  .sort();

const ASSET = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
const assets = new Set();
for (const name of readdirSync(OUT).filter((file) => file.endsWith(".html"))) {
  for (const match of readFileSync(`${OUT}${name}`, "utf8").matchAll(ASSET)) assets.add(match[1]);
}

const LAZY_GROUP_MAX_BYTES = 300_000;
const CHUNK_REF = /static\/chunks\/[A-Za-z0-9_.-]+\.(?:js|css)/g;
const skipped = [];
for (const asset of [...assets].filter((path) => path.endsWith(".js"))) {
  const group = new Set(
    [...readFileSync(`${OUT}${asset.slice(1)}`, "utf8").matchAll(CHUNK_REF)].map((m) => `/_next/${m[0]}`),
  );
  if (group.size === 0) continue;
  const bytes = [...group].reduce((sum, path) => sum + statSync(`${OUT}${path.slice(1)}`).size, 0);
  if (bytes > LAZY_GROUP_MAX_BYTES) skipped.push(`${asset} (${group.size} chunks, ${Math.round(bytes / 1000)} KB)`);
  else for (const path of group) assets.add(path);
}

const hash = createHash("sha256");
for (const page of pages) hash.update(readFileSync(`${OUT}${page === "/" ? "index" : page.slice(1)}.html`));
hash.update(readFileSync(`${OUT}api/search`));
const version = hash.digest("hex").slice(0, VERSION_LENGTH);

const worker = readFileSync(SOURCE, "utf8")
  .replace("self.__KAKURE_DOCS_PAGES__", JSON.stringify(pages))
  .replace("self.__KAKURE_DOCS_ASSETS__", JSON.stringify([...assets].sort()))
  .replace("self.__KAKURE_DOCS_VERSION__", JSON.stringify(version));
writeFileSync(`${OUT}sw.js`, worker);
console.log(
  `out/sw.js: ${pages.length} pages, ${assets.size} assets and the search index precached (version ${version})`,
);
for (const group of skipped) console.log(`  cached on first use, not precached: chunks loaded by ${group}`);
