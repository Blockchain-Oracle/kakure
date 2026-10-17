/**
 * `pnpm --filter @kakure/web dev`: serves the operator's real signed files and starts `next dev`.
 *
 * The operator (services/operator) writes each network's public files to
 * services/operator/operator-data/<network>/public/<network>/ (the R2 key layout). This tiny static server exposes them as
 * /data/<network>/<file> on 127.0.0.1, and next.config.ts proxies /data/* to it in development only,
 * so the app reads exactly what production will serve from the data worker. A missing file is a 404,
 * which the app shows as "No markets published yet".
 *
 * KAKURE_DATA_DIR=<dir> serves `<dir>/<network>/<file>` instead (e.g. files you signed yourself; pair it with
 * NEXT_PUBLIC_DEV_OPERATOR_KEY_TESTNET so this dev build verifies them).
 *
 * Port 3000 (or 3001: `pnpm --filter @kakure/web dev --port 3001`) matters: the price relay only allows
 * Origin http://localhost:3000 and :3001.
 */
import { spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const DATA_PORT = 4810; // keep in sync with src/dev-constants.ts
const portFlag = process.argv.indexOf("--port");
const APP_PORT = (portFlag > 0 ? process.argv[portFlag + 1] : undefined) ?? process.env.PORT ?? "3000";
const OPERATOR_DATA = fileURLToPath(new URL("../../../services/operator/operator-data/", import.meta.url));
const KEY = /^\/data\/(mainnet|testnet)\/([a-z0-9][a-z0-9._-]{0,127}\.json)$/;
const LATEST_CACHE = "public, max-age=20, stale-while-revalidate=40";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

const server = createServer((request, response) => {
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
      "cache-control": file === "latest.json" ? "no-cache" : IMMUTABLE_CACHE,
      "x-production-cache": file === "latest.json" ? LATEST_CACHE : IMMUTABLE_CACHE,
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(path).pipe(response);
    }
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(DATA_PORT, "127.0.0.1", () => {
  const served = process.env.KAKURE_DATA_DIR ?? `${OPERATOR_DATA}<network>/public`;
  console.log(`data: serving ${served}/<network>/ at http://127.0.0.1:${DATA_PORT}/data/<network>/`);
  const next = spawn("pnpm", ["exec", "next", "dev", "--port", APP_PORT], { stdio: "inherit" });
  const stop = () => {
    next.kill("SIGTERM");
    server.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  next.on("exit", (code) => {
    server.close();
    process.exit(code ?? 0);
  });
});
