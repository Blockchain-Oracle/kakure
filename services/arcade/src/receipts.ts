import {
  ARCADE_GAMES,
  BETS_MIN_RECEIPTS,
  type BetsBoard,
  type BetsPeriod,
  ENGINE_VERSION,
  NICKNAME_PATTERN,
  type Profile,
  profileBadges,
  RANK_LIMIT,
  RECEIPT_MIN_TRADES,
  type ReceiptAccepted,
  receiptId,
  SIGNED_SKEW_SEC,
} from "@kakure/arcade";
import { parseWindowId, type WindowState } from "@kakure/domain";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { DAY_SEC, TAPE_NETWORK, WEEK_DAYS } from "./constants";
import { dayOf, type Verdict } from "./handlers";
import type { ArcadeStore } from "./store";
import { latestBundle, operatorKey, printedWindow } from "./tapes";
import { BAD_REQUEST, CONFLICT, NOT_FOUND, nowSec, refuse, UNAUTHORIZED, UNPROCESSABLE } from "./verdicts";

/**
 * Bets and profiles on the arcade service (plan §0 R7 under v2). A published receipt is checked in full (the arcade
 * key's signature and time, the operator's signature on the certificate, the Window's signed outcome and its grouped
 * trade count) and then kept as no more than its id, its key, right or wrong, and the day. The board and a profile's
 * tally count receipts published before today, so the board is recomputed daily and a publication's moment shows
 * nowhere.
 */
const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_ID = /^[0-9a-f]{64}$/;

const signed = { player: z.string().regex(HEX_KEY), at: z.number().int(), sig: z.string() };
const publishSchema = z.object({
  action: z.literal("publish"),
  certificate: z.record(z.string(), z.unknown()),
  ...signed,
});
const retractSchema = z.object({ action: z.literal("retract"), receipt: z.string().regex(HEX_ID), ...signed });
/** The parts of a certificate the check reads; the operator's signature covers the whole of it. */
const certificateSchema = z.object({
  kind: z.string(),
  window: z.string().optional(),
  side: z.string().optional(),
  lock: z.string().min(1),
});

function checkSigned(req: { player: string; at: number }): Verdict<null> {
  if (!verifyDocument(req as unknown as Record<string, unknown>, hexToBytes(req.player))) {
    return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  }
  if (Math.abs(nowSec() - req.at) > SIGNED_SKEW_SEC) return refuse(BAD_REQUEST, "the request is stale; try again");
  return { ok: true, body: null };
}

/** The Window as the operator signed it: from the latest bundle while it's listed, else its hour's prints file. */
async function signedWindow(id: string): Promise<WindowState | null> {
  const parsed = parseWindowId(id);
  if (!parsed) return null;
  const bundle = await latestBundle(Date.now());
  const listed = bundle.windows.find((w) => w.id === id && w.outcome);
  return listed ?? printedWindow(bundle, id, parsed.window.expirySec);
}

/** Where the check reads the operator's key and a Window's signed state (the tests pass their own). */
export interface ReceiptSources {
  operator: () => Uint8Array;
  windowOf: (id: string) => Promise<WindowState | null>;
}
const LIVE_SOURCES: ReceiptSources = { operator: operatorKey, windowOf: signedWindow };

export async function publishReceipt(
  store: ArcadeStore,
  raw: unknown,
  sources: ReceiptSources = LIVE_SOURCES,
): Promise<Verdict<ReceiptAccepted>> {
  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a receipt");
  const req = parsed.data;
  const auth = checkSigned(req);
  if (!auth.ok) return auth;
  if (store.nicknameOf(req.player) === null) return refuse(UNAUTHORIZED, "pick a nickname first");
  if (!verifyDocument(req.certificate, sources.operator())) {
    return refuse(UNPROCESSABLE, `that certificate isn't signed by the ${TAPE_NETWORK} operator`);
  }
  const cert = certificateSchema.safeParse(req.certificate);
  if (!cert.success || cert.data.kind !== "single" || !cert.data.window) {
    return refuse(UNPROCESSABLE, "only a single Up or Down call can be published");
  }
  const side = cert.data.side;
  if (side !== "U" && side !== "D") return refuse(UNPROCESSABLE, "only a single Up or Down call can be published");
  const window = await sources.windowOf(cert.data.window).catch(() => null);
  if (!window?.outcome) return refuse(CONFLICT, "its Window hasn't settled in the signed record yet");
  if (window.outcome === "refund") return refuse(UNPROCESSABLE, "a refunded Window decides nothing");
  if ((window.trades ?? 0) < RECEIPT_MIN_TRADES) {
    return refuse(
      UNPROCESSABLE,
      `its Window had fewer than ${RECEIPT_MIN_TRADES} trades, so publishing it would single it out`,
    );
  }
  const receipt = receiptId(cert.data.lock);
  const holder = store.receipts.holder(receipt);
  if (holder !== null && holder !== req.player) return refuse(CONFLICT, "another nickname published that position");
  const right = side === window.outcome;
  store.receipts.add(receipt, req.player, right, dayOf(nowSec()));
  return { ok: true, body: { receipt, right } };
}

export function retractReceipt(store: ArcadeStore, raw: unknown): Verdict<{ receipt: string }> {
  const parsed = retractSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a retraction");
  const req = parsed.data;
  const auth = checkSigned(req);
  if (!auth.ok) return auth;
  store.receipts.remove(req.receipt, req.player);
  return { ok: true, body: { receipt: req.receipt } };
}

export const isBetsPeriod = (value: string): value is BetsPeriod => value === "week" || value === "all";

export function betsBoard(store: ArcadeStore, period: BetsPeriod): BetsBoard {
  const now = nowSec();
  const beforeDay = dayOf(now);
  const fromDay = period === "all" ? 0 : dayOf(now - WEEK_DAYS * DAY_SEC);
  const rows = store.receipts.board(fromDay, beforeDay, BETS_MIN_RECEIPTS, RANK_LIMIT);
  return {
    network: TAPE_NETWORK,
    period,
    beforeDay,
    rows: rows.map(({ nickname, right, calls }) => ({ nickname, right, calls })),
  };
}

const profileSchema = z.object({ nickname: z.string().regex(NICKNAME_PATTERN) });

/** `POST /profile`: a nickname's public play; badges from it alone. The name travels in the body, never a path. */
export function readProfile(store: ArcadeStore, raw: unknown): Verdict<Profile> {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a nickname");
  const found = store.playerByNickname(parsed.data.nickname);
  if (!found) return refuse(NOT_FOUND, "no such nickname");
  const rating = store.duels.rating(found.player);
  const arcade: Profile["arcade"] = {};
  for (const game of ARCADE_GAMES) {
    const best = store.best(found.player, game, ENGINE_VERSION[game]);
    if (best !== null) arcade[game] = { best, rank: store.rank(game, ENGINE_VERSION[game], best) };
  }
  const tally = store.receipts.tally(found.player, dayOf(nowSec()));
  const figures = {
    duel: rating.finished > 0 ? { rating: rating.rating, won: rating.won, finished: rating.finished } : null,
    arcade,
    bets: tally.calls >= BETS_MIN_RECEIPTS ? tally : null,
  };
  const x = store.x.handleOf(found.player) !== null;
  return { ok: true, body: { nickname: found.nickname, x, ...figures, badges: profileBadges(figures) } };
}
