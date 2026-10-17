/**
 * `pnpm --filter @kakure/docs serve`: serves the static export (`out/`) the way a static host does
 * (`/rules` → rules.html, immutable `/_next/static`), so the built docs, search and offline mode can be checked
 * on this machine. Port 3002 by default; `--port <n>` to change.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const portFlag = process.argv.indexOf("--port");
const PORT = Number((portFlag > 0 ? process.argv[portFlag + 1] : undefined) ?? process.env.PORT ?? "3002");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const IMMUTABLE = "public, max-age=31536000, immutable";

function send(response, path, cache, type) {
  response.writeHead(200, {
    "content-type": type ?? TYPES[extname(path)] ?? "application/octet-stream",
    "content-length": statSync(path).size,
    "cache-control": cache,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  createReadStream(path).pipe(response);
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(OUT, clean), join(OUT, `${clean}.html`), join(OUT, clean, "index.html")];
  const found = candidates.find((path) => path.startsWith(OUT) && existsSync(path) && statSync(path).isFile());
  if (!found) {
    response.writeHead(404, { "content-type": TYPES[".html"] });
    createReadStream(join(OUT, "404.html")).pipe(response);
    return;
  }
  const type = pathname === "/api/search" ? TYPES[".json"] : undefined;
  send(response, found, pathname.startsWith("/_next/static/") ? IMMUTABLE : "no-cache", type);
}).listen(PORT, "127.0.0.1", () => console.log(`serving out/ at http://localhost:${PORT}`));
