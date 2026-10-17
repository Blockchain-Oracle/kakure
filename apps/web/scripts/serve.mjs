/**
 * `pnpm --filter @kakure/web serve`: serves the static export (`out/`) the way the data worker will in production
 * (`/markets` → markets.html, immutable `/_next/static`), plus `/data/<network>/<file>` from the operator's local
 * files, so the built site, its service worker and offline mode can be checked on this machine.
 * Port 3001 by default (the price relay allows Origin http://localhost:3000 and :3001); `--port 3000` to change.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const OPERATOR_DATA = fileURLToPath(new URL("../../../services/operator/operator-data/", import.meta.url));
const portFlag = process.argv.indexOf("--port");
const PORT = Number((portFlag > 0 ? process.argv[portFlag + 1] : undefined) ?? process.env.PORT ?? "3001");
const DATA = /^\/data\/(mainnet|testnet)\/([a-z0-9][a-z0-9._-]{0,127}\.json)$/;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};
const IMMUTABLE = "public, max-age=31536000, immutable";

function send(response, path, cache) {
  const stat = statSync(path);
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": cache,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  createReadStream(path).pipe(response);
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const data = DATA.exec(pathname);
  if (data) {
    const [, network, file] = data;
    const path = `${OPERATOR_DATA}${network}/public/${network}/${file}`;
    if (existsSync(path)) return send(response, path, file === "latest.json" ? "public, max-age=20" : IMMUTABLE);
    response.writeHead(404).end("Not found");
    return;
  }
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(OUT, clean), join(OUT, `${clean}.html`), join(OUT, clean, "index.html")];
  const found = candidates.find((path) => path.startsWith(OUT) && existsSync(path) && statSync(path).isFile());
  if (!found) {
    response.writeHead(404, { "content-type": TYPES[".html"] });
    createReadStream(join(OUT, "404.html")).pipe(response);
    return;
  }
  send(response, found, pathname.startsWith("/_next/static/") ? IMMUTABLE : "no-cache");
}).listen(PORT, "127.0.0.1", () => console.log(`serving out/ at http://localhost:${PORT}`));
