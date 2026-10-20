import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ARCADE_PATH, BOARD_LIMIT } from "@kakure/arcade";
import { BODY_MAX_BYTES, DB_PATH, HOUR_SEC, PORT } from "./constants";
import { commitPicks, duelState, joinQueue, leaveQueue, matchView, pairQueue, revealPicks, settleDuels } from "./duel";
import { duelBoard, duelHistory, duelRecent, isMatchId } from "./duel-views";
import {
  acceptScore,
  attractTape,
  isGame,
  isPeriod,
  issueRun,
  readBoard,
  readMe,
  register,
  SEED_LIFE_SEC,
  type Verdict,
} from "./handlers";
import { betsBoard, isBetsPeriod, publishReceipt, readProfile, retractReceipt } from "./receipts";
import { ArcadeStore } from "./store";
import { linkX, xConfig } from "./x";

/**
 * Kakure's arcade service (plan §0 R4). It is reached only through the site worker's `/arcade/` path, which forwards a
 * fresh request with nothing of the visitor's (no IP, no headers), so it never learns who is asking; it logs no request
 * either. Routes, all JSON:
 *
 *   POST /arcade/v1/run/<game>              a seed and the real-price tape it rides
 *   GET  /arcade/v1/board/<game>/<period>[/<limit>]   each nickname's best, day, week or all (up to 50)
 *   POST /arcade/v1/me                      a device key's nickname, best and all-time rank ({ game, player })
 *   POST /arcade/v1/player                  claim a nickname for a device key (signed, dated, with proof of work)
 *   POST /arcade/v1/score                   a signed run, replayed before it ranks
 *   GET  /arcade/v1/tape                    a tape for the cabinets' attract loops
 *   POST /arcade/v1/duel/state | history    the Duel: a key's queue or match, and its duels (signed)
 *   POST /arcade/v1/duel/queue | leave      join or leave the queue (signed)
 *   GET  /arcade/v1/duel/match/<id>         a match; picks show once both are revealed
 *   POST /arcade/v1/duel/commit | reveal    a commitment to the picks, then the picks (signed)
 *   GET  /arcade/v1/duel/board | recent     the Elo ladder; the last decided duels
 *   POST /arcade/v1/receipt | receipt/retract   publish a paid position's certificate, or take it back (signed)
 *   GET  /arcade/v1/bets/<week|all>         right calls per nickname with five receipts or more
 *   POST /arcade/v1/profile                 a nickname's public play and badges ({ nickname })
 *   GET  /arcade/v1/x/config                whether Sign in with X is on, and its client id and callback
 *   POST /arcade/v1/x/link                  an X sign-in's code and verifier: the handle becomes the name (signed)
 *
 * A device key travels only in request bodies, never in a path.
 */
const store = new ArcadeStore(DB_PATH);
/** The tick: duels read their cards' outcomes and the queue pairs this often; the clean-up runs on each new hour. */
const TICK_EVERY_MS = 20_000;
const MS = 1000;
const ATTRACT_CACHE = "public, max-age=300, stale-while-revalidate=900";
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
/** Path segments after `/arcade/v1/`: `tape`, `me`, `run/<game>`, `board/<game>/<period>[/<limit>]`. */
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
  if (request.method === "POST" && what === "me" && parts.length === ONE) {
    return answer(response, readMe(store, await body(request)));
  }
  if (request.method === "GET" && what === "tape" && parts.length === ONE) {
    return send(response, HTTP_OK, { tape: await attractTape() }, ATTRACT_CACHE);
  }
  if (request.method === "POST" && what === "run" && a && isGame(a) && parts.length === TWO) {
    return answer(response, await issueRun(store, a));
  }
  if (request.method === "POST" && what === "player" && parts.length === ONE) {
    return answer(response, register(store, await body(request)));
  }
  if (request.method === "POST" && what === "score" && parts.length === ONE) {
    return answer(response, acceptScore(store, await body(request)));
  }
  if (request.method === "POST" && what === "receipt" && parts.length === ONE) {
    return answer(response, await publishReceipt(store, await body(request)));
  }
  if (request.method === "POST" && what === "receipt" && a === "retract" && parts.length === TWO) {
    return answer(response, retractReceipt(store, await body(request)));
  }
  if (request.method === "GET" && what === "bets" && a && isBetsPeriod(a) && parts.length === TWO) {
    return send(response, HTTP_OK, betsBoard(store, a));
  }
  if (request.method === "POST" && what === "profile" && parts.length === ONE) {
    return answer(response, readProfile(store, await body(request)));
  }
  if (request.method === "GET" && what === "x" && a === "config" && parts.length === TWO) {
    return send(response, HTTP_OK, xConfig());
  }
  if (request.method === "POST" && what === "x" && a === "link" && parts.length === TWO) {
    return answer(response, await linkX(store, await body(request)));
  }
  if (what === "duel") return duelRoute(request, response, parts.slice(ONE));
  return send(response, HTTP_NOT_FOUND, { error: "not found" });
}

async function duelRoute(request: IncomingMessage, response: ServerResponse, rest: string[]): Promise<void> {
  const [what, id] = rest;
  const get = request.method === "GET";
  const post = request.method === "POST";
  if (post && what === "state" && !id) return answer(response, duelState(store, await body(request)));
  if (post && what === "history" && !id) return answer(response, duelHistory(store, await body(request)));
  if (get && what === "board" && !id) return send(response, HTTP_OK, duelBoard(store));
  if (get && what === "recent" && !id) return send(response, HTTP_OK, duelRecent(store));
  if (get && what === "match" && id && isMatchId(id)) {
    const match = matchView(store, id);
    return match ? send(response, HTTP_OK, match) : send(response, HTTP_NOT_FOUND, { error: "no such duel" });
  }
  if (post && what === "queue" && !id) return answer(response, await joinQueue(store, await body(request)));
  if (post && what === "leave" && !id) return answer(response, leaveQueue(store, await body(request)));
  if (post && what === "commit" && !id) return answer(response, commitPicks(store, await body(request)));
  if (post && what === "reveal" && !id) return answer(response, revealPicks(store, await body(request)));
  return send(response, HTTP_NOT_FOUND, { error: "not found" });
}

/** One tick at a time: a slow fetch from the site makes the next tick wait, never run beside it. */
let ticking = false;
let sweptHour = 0;
async function tick(): Promise<void> {
  await settleDuels(store).catch(() => undefined);
  await pairQueue(store).catch(() => undefined);
  const now = Math.floor(Date.now() / MS);
  const hour = Math.floor(now / HOUR_SEC);
  if (hour !== sweptHour) {
    store.sweep(now, SEED_LIFE_SEC, hour);
    sweptHour = hour;
  }
}
setInterval(() => {
  if (ticking) return;
  ticking = true;
  void tick().finally(() => {
    ticking = false;
  });
}, TICK_EVERY_MS);

createServer((request, response) => {
  route(request, response).catch(() => {
    if (!response.headersSent) send(response, HTTP_BAD_REQUEST, { error: "that request couldn't be read" });
  });
}).listen(PORT, () => {
  process.stdout.write(`arcade: listening on ${PORT}\n`);
});
