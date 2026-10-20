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
  receiptId,
  SIGNED_SKEW_SEC,
  weekOf,
  weekStartDay,
} from "@kakure/arcade";
import { verifyUnblinded } from "@kakure/ecash";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { TAPE_NETWORK } from "./constants";
import type { Verdict } from "./handlers";
import { firstUse } from "./replays";
import type { ArcadeStore } from "./store";
import { latestBundle } from "./tapes";
import { BAD_REQUEST, CONFLICT, NOT_FOUND, nowSec, refuse, UNAUTHORIZED, UNAVAILABLE } from "./verdicts";

/**
 * Bets and profiles on the arcade service (plan §0 R7 under v2, reworked after its privacy reviews). A call reaches
 * this service only as a blind receipt: a secret the device chose, the operator's unblinded signature on it under its
 * "right" or its "wrong" key, and the NUT-12 DLEQ proof, checked here against the receipt keys in the operator's latest
 * signed bundle. The operator signed a blinded point it can't recognise again, so nothing this service holds leads
 * back to the trade, and the operator never learns the nickname. The service keeps the receipt id (a hash of its
 * secret), the key, right or wrong, and the week it was published.
 *
 * The board and profiles change once a week: a receipt counts from the week after it's published, and a retraction
 * takes effect at the next week's turn too, so neither a publication's day nor a retraction's shows.
 */
const HEX = /^[0-9a-f]{64}$/;
const SCALAR = /^[0-9a-f]{64}$/;
const POINT = /^0[23][0-9a-f]{64}$/;

const signed = { player: z.string().regex(HEX), at: z.number().int(), sig: z.string() };
const publishSchema = z.object({ action: z.literal("publish"), token: z.record(z.string(), z.unknown()), ...signed });
const retractSchema = z.object({ action: z.literal("retract"), receipt: z.string().regex(HEX), ...signed });
const tokenSchema = z.object({
  v: z.literal(2),
  network: z.string(),
  right: z.boolean(),
  secret: z.string().regex(HEX),
  C: z.string().regex(POINT),
  dleq: z.object({ e: z.string().regex(SCALAR), s: z.string().regex(SCALAR), r: z.string().regex(SCALAR) }),
});

function checkSigned(req: { player: string; at: number; sig: string }): Verdict<null> {
  if (!verifyDocument(req as unknown as Record<string, unknown>, hexToBytes(req.player))) {
    return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  }
  if (Math.abs(nowSec() - req.at) > SIGNED_SKEW_SEC) return refuse(BAD_REQUEST, "the request is stale; try again");
  return { ok: true, body: null };
}

const replayed = <T>(): Verdict<T> => refuse(CONFLICT, "that request was already sent");

/** The operator's receipt keys, from its latest signed bundle (the bundle is checked against the pinned key). */
async function liveReceiptKeys(): Promise<{ right: string; wrong: string } | null> {
  return (await latestBundle(Date.now()).catch(() => null))?.trading?.receiptKeys ?? null;
}

export async function publishReceipt(
  store: ArcadeStore,
  raw: unknown,
  receiptKeys: () => Promise<{ right: string; wrong: string } | null> = liveReceiptKeys,
): Promise<Verdict<ReceiptAccepted>> {
  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a receipt");
  const req = parsed.data;
  if (store.nicknameOf(req.player) === null) return refuse(UNAUTHORIZED, "pick a nickname first");
  const token = tokenSchema.safeParse(req.token);
  if (!token.success || token.data.network !== TAPE_NETWORK) {
    return refuse(BAD_REQUEST, `that isn't a ${TAPE_NETWORK} receipt`);
  }
  const keys = await receiptKeys();
  if (!keys) return refuse(UNAVAILABLE, "the operator's receipt keys aren't published yet");
  const { right, secret, C, dleq } = token.data;
  if (!verifyUnblinded({ secret: utf8ToBytes(secret), C, dleq }, right ? keys.right : keys.wrong)) {
    return refuse(UNAUTHORIZED, `that receipt isn't signed by the ${TAPE_NETWORK} operator`);
  }
  const auth = checkSigned(req);
  if (!auth.ok) return auth;
  const receipt = receiptId(secret);
  const holder = store.receipts.holder(receipt);
  if (holder !== null && holder !== req.player) return refuse(CONFLICT, "another nickname published that call");
  if (!firstUse(req.sig, nowSec())) return replayed();
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
  if (store.receipts.holder(req.receipt) !== req.player)
    return refuse(NOT_FOUND, "this key has no such call on the board");
  if (!firstUse(req.sig, nowSec())) return replayed();
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
