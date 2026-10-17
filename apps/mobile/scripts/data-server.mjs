/**
 * `pnpm --filter @kakure/mobile data`: serves the local operator's real signed files to a development build.
 *
 * The operator (services/operator) writes each network's public files to
 * services/operator/operator-data/<network>/public/<network>/ (the R2 key layout). This static server exposes them
 * as /data/<network>/<file> on 127.0.0.1:4810, the address a simulator reaches; start the app with
 * EXPO_PUBLIC_DATA_BASE=http://127.0.0.1:4810/data so it reads exactly what production serves from the data
 * worker, verified against the same pinned key. KAKURE_DATA_DIR=<dir> serves `<dir>/<network>/<file>` instead.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.KAKURE_DATA_PORT ?? 4810);
const OPERATOR_DATA = fileURLToPath(new URL("../../../services/operator/operator-data/", import.meta.url));
const KEY = /^\/data\/(mainnet|testnet)\/([a-z0-9][a-z0-9._-]{0,127}\.json)$/;
const IMMUTABLE = "public, max-age=31536000, immutable";

createServer((request, response) => {
  const match = KEY.exec(new URL(request.url ?? "/", "http://localhost").pathname);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404).end("Not found");
    return;
  }
  const [, network, file] = match;
  const root = process.env.KAKURE_DATA_DIR ?? `${OPERATOR_DATA}${network}/public`;
  const path = `${root}/${network}/${file}`;
  try {
    const stat = statSync(path);
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": stat.size,
      "cache-control": file === "latest.json" ? "no-cache" : IMMUTABLE,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(
    `data: http://127.0.0.1:${PORT}/data/<network>/ ← ${process.env.KAKURE_DATA_DIR ?? `${OPERATOR_DATA}<network>/public`}`,
  );
});
