/**
 * Runs after `next build`: fills in out/sw.js's precache list (O7) and a build id hashed from it, so every visitor's
 * worker downloads the same set on install and a new deploy gets a fresh shell cache.
 *
 * Precached: every script, stylesheet, WebAssembly module and image under out/_next/static (all routes' chunks,
 * including the bet sheet's lazy ones and the address checker's .wasm), and the fonts the pages preload: the latin
 * files of Sora, Inter and JetBrains Mono and both weights of the Noto Serif JP subset (src/app/layout.tsx). Other
 * font subsets are left to the browser (it picks them by the characters on screen, which are the same for everyone).
 * The games' sound files (public/sounds, Kenney CC0) are precached too, so every visitor holds the same set and no
 * request for one says that this visitor opened the games.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const STATIC = join(OUT, "_next/static");
const WORKER = join(OUT, "sw.js");
const KINDS = new Set([".js", ".css", ".wasm", ".svg", ".png", ".jpg", ".webp"]);
const PRELOADED_FONT = /<link rel="preload" href="(\/_next\/static\/media\/[^"]+\.woff2)"/g;
const BUILD_ID_LENGTH = 12;
const SOUNDS = join(OUT, "sounds");
const SOUND = ".mp3";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = new Set(
  walk(STATIC)
    .filter((path) => KINDS.has(extname(path)))
    .map((path) => `/${relative(OUT, path).split("\\").join("/")}`),
);
for (const page of readdirSync(OUT).filter((name) => name.endsWith(".html"))) {
  for (const match of readFileSync(join(OUT, page), "utf8").matchAll(PRELOADED_FONT)) files.add(match[1]);
}
for (const name of readdirSync(SOUNDS).filter((file) => extname(file) === SOUND)) files.add(`/sounds/${name}`);
const list = [...files].sort();
const bytes = list.reduce((sum, path) => sum + statSync(join(OUT, path.slice(1))).size, 0);
const build = createHash("sha256").update(list.join("\n")).digest("hex").slice(0, BUILD_ID_LENGTH);

const worker = readFileSync(WORKER, "utf8");
if (!worker.includes("self.__KAKURE_PRECACHE__")) throw new Error("out/sw.js has no precache placeholder");
writeFileSync(
  WORKER,
  worker
    .replace("self.__KAKURE_PRECACHE__", JSON.stringify(list))
    .replace("self.__KAKURE_BUILD__", JSON.stringify(build)),
);
console.log(`out/sw.js: ${list.length} files (${Math.round(bytes / 1024)} KB raw) precached, build ${build}`);
