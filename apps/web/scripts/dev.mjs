/**
 * `pnpm --filter @kakure/web dev`: serves the operator's real signed files and starts `next dev`.
 *
 * The operator (services/operator) writes each network's public files to
 * services/operator/operator-data/<network>/public/<network>/ (the data worker's key layout). This tiny static server exposes them as
 * /data/<network>/<file> on 127.0.0.1, and next.config.ts proxies /data/* to it in development only,
 * so the app reads exactly what production will serve from the data worker. A missing file is a 404,
 * which the app shows as "No markets published yet". A network with no local operator files (its operator runs on
 * the server, as testnet does since 2026-10-18) is served from the live data worker instead: the same signed files.
 *
 * KAKURE_DATA_DIR=<dir> serves `<dir>/<network>/<file>` instead (e.g. files you signed yourself; pair it with
 * NEXT_PUBLIC_DEV_OPERATOR_KEY_TESTNET so this dev build verifies them).
 *
 * Port 3000 (or 3001: `pnpm --filter @kakure/web dev --port 3001`) matters: the price relay only allows
 * Origin http://localhost:3000 and :3001.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const DATA_PORT = 4810; // keep in sync with src/dev-constants.ts
const portFlag = process.argv.indexOf("--port");
const APP_PORT = (portFlag > 0 ? process.argv[portFlag + 1] : undefined) ?? process.env.PORT ?? "3000";
const OPERATOR_DATA = fileURLToPath(new URL("../../../services/operator/operator-data/", import.meta.url));
const KEY = /^\/data\/(mainnet|testnet)\/([a-z0-9][a-z0-9._-]{0,127}\.json)$/;
const LATEST_CACHE = "public, max-age=20, stale-while-revalidate=40";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const LIVE_DATA = "https://kakure-web.kakure-price-relay.workers.dev/data";

/** Trading calls (`POST /ohttp/<network>`) go to a local operator gateway, as the data worker relays them in production. */
const OHTTP = /^\/ohttp\/(mainnet|testnet)$/;
const GATEWAY = {
  testnet: process.env.KAKURE_DEV_GATEWAY_TESTNET ?? "http://127.0.0.1:8790/gateway",
  mainnet: process.env.KAKURE_DEV_GATEWAY_MAINNET,
};

async function relayOhttp(request, response, network) {
  const gateway = GATEWAY[network];
  if (request.method !== "POST" || !gateway) {
    response.writeHead(gateway ? 405 : 503).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  // A fresh request with only the content type, like services/data-worker/src/relay.ts.
  const upstream = await fetch(gateway, {
    method: "POST",
    headers: { "content-type": "message/ohttp-req" },
    body: Buffer.concat(chunks),
  }).catch(() => null);
  if (!upstream) {
    response.writeHead(502).end();
    return;
  }
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "text/plain",
    "cache-control": "no-store",
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

/** The arcade's API goes to a local arcade service (services/arcade), as the data worker forwards it in production. */
const ARCADE = process.env.KAKURE_DEV_ARCADE ?? "http://127.0.0.1:8796";

async function relayArcade(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  // A fresh request with only the method, the path and the body, like services/data-worker/src/arcade.ts.
  const upstream = await fetch(`${ARCADE}${pathname}`, {
    method: request.method,
    headers: request.method === "POST" ? { "content-type": "application/json" } : {},
    ...(request.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
  }).catch(() => null);
  if (!upstream) {
    response.writeHead(502).end();
    return;
  }
  response.writeHead(upstream.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": upstream.headers.get("cache-control") ?? "no-store",
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname.startsWith("/arcade/v1/")) {
    await relayArcade(request, response, pathname);
    return;
  }
  const ohttp = OHTTP.exec(pathname);
  if (ohttp) {
    await relayOhttp(request, response, ohttp[1]);
    return;
  }
  const match = KEY.exec(new URL(request.url ?? "/", "http://localhost").pathname);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404).end("Not found");
    return;
  }
  const [, network, file] = match;
  const root = process.env.KAKURE_DATA_DIR ?? `${OPERATOR_DATA}${network}/public`;
  const path = `${root}/${network}/${file}`;
  if (!process.env.KAKURE_DATA_DIR && !existsSync(`${OPERATOR_DATA}${network}`)) {
    const live = await fetch(`${LIVE_DATA}/${network}/${file}`).catch(() => null);
    if (!live?.ok) {
      response.writeHead(live?.status ?? 502).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : Buffer.from(await live.arrayBuffer()));
    return;
  }
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
