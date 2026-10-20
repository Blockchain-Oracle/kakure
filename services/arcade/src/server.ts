import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ARCADE_PATH, BOARD_LIMIT } from "@kakure/arcade";
import { BODY_MAX_BYTES, DB_PATH, PORT } from "./constants";
import {
  acceptScore,
  attractTape,
  isGame,
  isPeriod,
  isPlayerKey,
  issueRun,
  readBoard,
  readMe,
  register,
  type Verdict,
} from "./handlers";
import { ArcadeStore } from "./store";

/**
 * Kakure's arcade service (plan §0 R4). It is reached only through the site worker's `/arcade/` path, which forwards a
 * fresh request with nothing of the visitor's (no IP, no headers), so it never learns who is asking; it logs no request
 * either. Routes, all JSON:
 *
 *   POST /arcade/v1/run/<game>              a seed and the real-price tape it rides
 *   GET  /arcade/v1/board/<game>/<period>[/<limit>]   each nickname's best, day, week or all (up to 50)
 *   GET  /arcade/v1/me/<game>/<player>      a device key's nickname, best and all-time rank
 *   POST /arcade/v1/player                  claim a nickname for a device key (signed, with proof of work)
 *   POST /arcade/v1/score                   a signed run, replayed before it ranks
 *   GET  /arcade/v1/tape                    a tape for the cabinets' attract loops
 */
const store = new ArcadeStore(DB_PATH);
const ATTRACT_CACHE = "public, max-age=300, stale-while-revalidate=900";
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
/** Path segments after `/arcade/v1/`: `tape`, `run/<game>`, `board/<game>/<period>[/<limit>]`, `me/<game>/<player>`. */
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FOUR = 4;

function send(response: ServerResponse, status: number, body: unknown, cache = "no-store"): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": cache });
  response.end(JSON.stringify(body));
}

function answer<T>(response: ServerResponse, verdict: Verdict<T>): void {
  if (verdict.ok) send(response, HTTP_OK, verdict.body);
  else send(response, verdict.status, { error: verdict.error });
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > BODY_MAX_BYTES) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", "http://arcade").pathname;
  if (!path.startsWith(`${ARCADE_PATH}/`)) return send(response, HTTP_NOT_FOUND, { error: "not found" });
  const parts = path.slice(ARCADE_PATH.length + 1).split("/");
  const [what, a, b] = parts;
  // The site worker forwards the path only (never a query), so a board's length rides in the path.
  if (request.method === "GET" && what === "board" && a && b && isGame(a) && isPeriod(b) && parts.length <= FOUR) {
    const limit = parts.length === FOUR ? Number(parts[THREE]) : BOARD_LIMIT;
    if (parts.length === THREE || parts.length === FOUR) return send(response, HTTP_OK, readBoard(store, a, b, limit));
  }
  if (request.method === "GET" && what === "me" && a && b && isGame(a) && isPlayerKey(b) && parts.length === THREE) {
    return send(response, HTTP_OK, readMe(store, a, b));
  }
  if (request.method === "GET" && what === "tape" && parts.length === ONE) {
    return send(response, HTTP_OK, { tape: await attractTape() }, ATTRACT_CACHE);
  }
  if (request.method === "POST" && what === "run" && a && isGame(a) && parts.length === TWO) {
    return send(response, HTTP_OK, await issueRun(store, a));
  }
  if (request.method === "POST" && what === "player" && parts.length === ONE) {
    return answer(response, register(store, await body(request)));
  }
  if (request.method === "POST" && what === "score" && parts.length === ONE) {
    return answer(response, acceptScore(store, await body(request)));
  }
  return send(response, HTTP_NOT_FOUND, { error: "not found" });
}

createServer((request, response) => {
  route(request, response).catch(() => {
    if (!response.headersSent) send(response, HTTP_BAD_REQUEST, { error: "that request couldn't be read" });
  });
}).listen(PORT, () => {
  process.stdout.write(`arcade: listening on ${PORT}\n`);
});
