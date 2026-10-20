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
  type ReceiptAccepted,
  SIGNED_SKEW_SEC,
  weekOf,
  weekStartDay,
} from "@kakure/arcade";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { TAPE_NETWORK } from "./constants";
import type { Verdict } from "./handlers";
import type { ArcadeStore } from "./store";
import { operatorKey } from "./tapes";
import { BAD_REQUEST, CONFLICT, NOT_FOUND, nowSec, refuse, UNAUTHORIZED } from "./verdicts";

/**
 * Bets and profiles on the arcade service (plan §0 R7 under v2, reworked after its privacy review). A call reaches
 * this service only as the operator's signed receipt token `{type, network, receipt, right, player}`, which the
 * device got over Oblivious HTTP after the operator checked the position, its Window's outcome and its trade count on
 * its own book: the trade itself (Window, side, stake, time) never comes here, and never travels beside an IP. The
 * service keeps the receipt id, the key, right or wrong, and the week it was published.
 *
 * The board and profiles change once a week: a receipt counts from the week after it's published, and a retraction
 * takes effect at the next week's turn too, so neither a publication's day nor a retraction's shows.
 */
const HEX = /^[0-9a-f]{64}$/;
/** A request's signature is remembered this long, so a copy can't be sent again while its time is still good. */
const REPLAY_MEMORY_SEC = 2 * SIGNED_SKEW_SEC;

const signed = { player: z.string().regex(HEX), at: z.number().int(), sig: z.string() };
const publishSchema = z.object({ action: z.literal("publish"), token: z.record(z.string(), z.unknown()), ...signed });
const retractSchema = z.object({ action: z.literal("retract"), receipt: z.string().regex(HEX), ...signed });
const tokenSchema = z.object({
  v: z.literal(1),
  type: z.literal("kakure-receipt"),
  network: z.string(),
  receipt: z.string().regex(HEX),
  right: z.boolean(),
  player: z.string().regex(HEX),
});

const seen = new Map<string, number>();

/** True the first time a signature is used within its memory; a replayed copy of a request is refused. */
function firstUse(sig: string, now: number): boolean {
  for (const [old, until] of seen) if (until < now) seen.delete(old);
  if (seen.has(sig)) return false;
  seen.set(sig, now + REPLAY_MEMORY_SEC);
  return true;
}

function checkSigned(req: { player: string; at: number; sig: string }): Verdict<null> {
  if (!verifyDocument(req as unknown as Record<string, unknown>, hexToBytes(req.player))) {
    return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  }
  const now = nowSec();
  if (Math.abs(now - req.at) > SIGNED_SKEW_SEC) return refuse(BAD_REQUEST, "the request is stale; try again");
  if (!firstUse(req.sig, now)) return refuse(CONFLICT, "that request was already sent");
  return { ok: true, body: null };
}

export async function publishReceipt(
  store: ArcadeStore,
  raw: unknown,
  operator: () => Uint8Array = operatorKey,
): Promise<Verdict<ReceiptAccepted>> {
  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a receipt");
  const req = parsed.data;
  if (store.nicknameOf(req.player) === null) return refuse(UNAUTHORIZED, "pick a nickname first");
  if (!verifyDocument(req.token, operator())) {
    return refuse(UNAUTHORIZED, `that receipt isn't signed by the ${TAPE_NETWORK} operator`);
  }
  const token = tokenSchema.safeParse(req.token);
  if (!token.success || token.data.network !== TAPE_NETWORK || token.data.player !== req.player) {
    return refuse(BAD_REQUEST, `that receipt isn't one for this key on ${TAPE_NETWORK}`);
  }
  const auth = checkSigned(req);
  if (!auth.ok) return auth;
  const { receipt, right } = token.data;
  const holder = store.receipts.holder(receipt);
  if (holder !== null && holder !== req.player) return refuse(CONFLICT, "another nickname published that call");
  store.receipts.add(receipt, req.player, right, weekOf(nowSec()));
  return { ok: true, body: { receipt, right } };
}

/** Takes a call off the board at the next week's turn; refused when this key never published it. */
export function retractReceipt(store: ArcadeStore, raw: unknown): Verdict<{ receipt: string }> {
  const parsed = retractSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a retraction");
  const req = parsed.data;
  const auth = checkSigned(req);
  if (!auth.ok) return auth;
  if (!store.receipts.retract(req.receipt, req.player, weekOf(nowSec()))) {
    return refuse(NOT_FOUND, "this key has no such call on the board");
  }
  return { ok: true, body: { receipt: req.receipt } };
}

export const isBetsPeriod = (value: string): value is BetsPeriod => value === "week" || value === "all";

/** `GET /bets/<week|all>`: last week's calls, or every week's, counted to the start of this week. */
export function betsBoard(store: ArcadeStore, period: BetsPeriod): BetsBoard {
  const week = weekOf(nowSec());
  const rows = store.receipts.board(period === "all" ? 0 : week - 1, week, BETS_MIN_RECEIPTS, RANK_LIMIT);
  return {
    network: TAPE_NETWORK,
    period,
    beforeDay: weekStartDay(week),
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
  const tally = store.receipts.tally(found.player, weekOf(nowSec()));
  const figures = {
    duel: rating.finished > 0 ? { rating: rating.rating, won: rating.won, finished: rating.finished } : null,
    arcade,
    bets: tally.calls >= BETS_MIN_RECEIPTS ? tally : null,
  };
  const x = store.x.handleOf(found.player) !== null;
  return { ok: true, body: { nickname: found.nickname, x, ...figures, badges: profileBadges(figures) } };
}
