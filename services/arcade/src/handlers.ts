import { createHash, randomBytes } from "node:crypto";
import {
  ARCADE_GAMES,
  type ArcadeGame,
  BOARD_LIMIT,
  BOARD_PERIODS,
  type Board,
  type BoardPeriod,
  ENGINE_VERSION,
  envelopeCheck,
  isArcadeSeed,
  MAX_RUN_SEC,
  MAX_RUN_TICKS,
  NICKNAME_PATTERN,
  powMeets,
  RANK_LIMIT,
  type RunIssued,
  replayArcade,
  type ScoreAccepted,
  SIGNED_SKEW_SEC,
  type Standing,
  seedFromBytes,
  ticksToMs,
  traceCanonical,
} from "@kakure/arcade";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { DAY_SEC, HOUR_SEC, PER_PLAYER_PER_HOUR, SEED_GRACE_SEC, SEEDS_MAX, WEEK_DAYS } from "./constants";
import { firstUse } from "./replays";
import type { ArcadeStore } from "./store";
import { tapeFor } from "./tapes";

/**
 * The arcade's answers (Mitoshi `web/src/features/games/arcade/score.server.ts`, on a nickname and device key instead
 * of a wallet session). A score is accepted only when the service's replay of the same engine over the same seed, tape
 * and inputs reproduces it to the tick; it can't prove a browser wasn't scripted, and the board says "server-checked".
 * Cheapest refusal first: the shape, the signature, the player, the engine build, the envelope, the hourly limit (a
 * post counts before it's replayed, so replays per key are bounded), the seed, then the replay, capped at the run's
 * claimed length, and the record.
 */
export type Verdict<T> = { ok: true; body: T } | { ok: false; status: number; error: string };

const MS = 1000;
const SEED_BYTES = 4;
const ISSUE_TRIES = 4;
const HEX_KEY = /^[0-9a-f]{64}$/;
const DATE_DIGITS = 8;
/** The replay plays at most the claimed length and this many ticks more (the length check allows one either way). */
const REPLAY_SLACK_TICKS = 2;

const nowSec = () => Math.floor(Date.now() / MS);

/** `YYYYMMDD` of a time, in UTC: a run keeps its day, never its time. */
export function dayOf(sec: number): number {
  return Number(
    new Date(sec * MS).toISOString().slice(0, "YYYY-MM-DD".length).replaceAll("-", "").slice(0, DATE_DIGITS),
  );
}

export const isGame = (value: string): value is ArcadeGame => (ARCADE_GAMES as readonly string[]).includes(value);
export const isPeriod = (value: string): value is BoardPeriod => (BOARD_PERIODS as readonly string[]).includes(value);

function sinceDay(period: BoardPeriod): number {
  if (period === "all") return 0;
  const days = period === "day" ? 0 : WEEK_DAYS - 1;
  return dayOf(nowSec() - days * DAY_SEC);
}

export const isPlayerKey = (value: string): boolean => HEX_KEY.test(value);

export function readBoard(store: ArcadeStore, game: ArcadeGame, period: BoardPeriod, limit = BOARD_LIMIT): Board {
  const engineVersion = ENGINE_VERSION[game];
  const wanted = Number.isInteger(limit) ? limit : BOARD_LIMIT;
  const rows = store.board(game, engineVersion, sinceDay(period), Math.min(Math.max(1, wanted), RANK_LIMIT));
  return { game, period, engineVersion, rows };
}

const standingSchema = z.object({ game: z.enum(["line-rider", "candle-hop"]), player: z.string().regex(HEX_KEY) });

/** `POST /me`: a device key's standing on one game's all-time board (nulls before its first run). */
export function readMe(store: ArcadeStore, raw: unknown): Verdict<Standing> {
  const parsed = standingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "that isn't a standing request" };
  const { game, player } = parsed.data;
  const engineVersion = ENGINE_VERSION[game];
  const best = store.best(player, game, engineVersion);
  return {
    ok: true,
    body: {
      nickname: store.nicknameOf(player),
      best,
      rank: best === null ? null : store.rank(game, engineVersion, best),
    },
  };
}

/** How long an issued seed stays good. */
export const SEED_LIFE_SEC = MAX_RUN_SEC + SEED_GRACE_SEC;

/**
 * A seed for the next run, with the tape it rides, both kept so the score check replays the same terrain. Past
 * `SEEDS_MAX` outstanding seeds a run is refused until some are posted or expire, so issuing can't fill the disk.
 */
/** Runs being issued right now (their tape still loading): they count against the cap before they're stored. */
let issuing = 0;

export async function issueRun(store: ArcadeStore, game: ArcadeGame): Promise<Verdict<RunIssued>> {
  if (store.outstanding() + issuing >= SEEDS_MAX) {
    return { ok: false, status: 503, error: "the arcade is busy; try again soon" };
  }
  issuing += 1;
  try {
    for (let i = 0; i < ISSUE_TRIES; i++) {
      const seed = seedFromBytes(randomBytes(SEED_BYTES));
      const now = nowSec();
      const tape = await tapeFor(seed, now * MS);
      if (store.issue(seed, game, tape, now)) {
        return { ok: true, body: { seed, tape, engineVersion: ENGINE_VERSION[game] } };
      }
    }
    throw new Error("couldn't issue a seed");
  } finally {
    issuing -= 1;
  }
}

/** A tape for the cabinets' attract loops: a fresh cut, never stored and never rankable. */
export async function attractTape(): Promise<RunIssued["tape"]> {
  return tapeFor(seedFromBytes(randomBytes(SEED_BYTES)), Date.now());
}

const registrationSchema = z.object({
  player: z.string().regex(HEX_KEY),
  nickname: z.string().regex(NICKNAME_PATTERN),
  nonce: z.number().int().nonnegative(),
  at: z.number().int(),
  sig: z.string(),
});

const signedBy = (document: Record<string, unknown>, player: string): boolean =>
  verifyDocument(document, hexToBytes(player));

/** Claims a nickname for a device key: signed by that key, with the work done, and not held by another key. */
export function register(store: ArcadeStore, raw: unknown): Verdict<{ nickname: string }> {
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      status: 400,
      error: "a claim is a key, a nickname of 3–16 letters, digits, _ or -, and its work",
    };
  const claim = parsed.data;
  if (!signedBy(claim, claim.player)) return { ok: false, status: 401, error: "the claim isn't signed by its key" };
  if (Math.abs(nowSec() - claim.at) > SIGNED_SKEW_SEC) {
    return { ok: false, status: 400, error: "the claim is stale; try again" };
  }
  if (!powMeets(claim, claim.nonce)) return { ok: false, status: 422, error: "the claim's work falls short" };
  if (!firstUse(claim.sig, nowSec())) return { ok: false, status: 409, error: "that claim was already sent" };
  const handle = store.x.handleOf(claim.player);
  if (handle !== null && handle.toLowerCase() !== claim.nickname.toLowerCase()) {
    return { ok: false, status: 409, error: `this device signed in with X: its name is ${handle}` };
  }
  if (!store.claim(claim.player, claim.nickname)) return { ok: false, status: 409, error: "that nickname is taken" };
  return { ok: true, body: { nickname: claim.nickname } };
}

const claimSchema = z.object({
  game: z.enum(["line-rider", "candle-hop"]),
  seed: z.string().refine(isArcadeSeed, "not an arcade seed"),
  engineVersion: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  calm: z.boolean(),
  trace: z.array(z.number().int().nonnegative()).max(MAX_RUN_TICKS * 2),
  player: z.string().regex(HEX_KEY),
  sig: z.string(),
});

export function acceptScore(store: ArcadeStore, raw: unknown): Verdict<ScoreAccepted> {
  const parsed = claimSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "that isn't a score claim" };
  const claim = parsed.data;
  if (!signedBy(claim, claim.player)) return { ok: false, status: 401, error: "the claim isn't signed by its key" };
  if (store.nicknameOf(claim.player) === null) return { ok: false, status: 401, error: "pick a nickname first" };
  const engineVersion = ENGINE_VERSION[claim.game];
  if (claim.engineVersion !== engineVersion) {
    return { ok: false, status: 409, error: "that run was played on another engine build" };
  }
  const envelope = envelopeCheck(claim.game, claim.durationMs, claim.trace, claim.score);
  if (!envelope.ok) return { ok: false, status: 422, error: envelope.why };
  const now = nowSec();
  if (!store.allowPost(claim.player, Math.floor(now / HOUR_SEC), PER_PLAYER_PER_HOUR)) {
    return { ok: false, status: 429, error: "too many runs this hour" };
  }
  const tape = store.take(claim.seed, claim.game, now, SEED_LIFE_SEC);
  if (tape === undefined) {
    return { ok: false, status: 422, error: "that run's seed wasn't issued here, was posted, or expired" };
  }
  const replay = replayArcade(
    claim.game,
    claim.seed,
    claim.trace,
    { calm: claim.calm, ...(tape ? { tape: tape.points, moves: tape.moves } : {}) },
    envelope.ticks + REPLAY_SLACK_TICKS,
  );
  if (!replay.ended) return { ok: false, status: 422, error: "the run never ended" };
  if (replay.score !== claim.score) return { ok: false, status: 422, error: "the replay doesn't reproduce that score" };
  if (Math.abs(replay.ticks - envelope.ticks) > 1) {
    return { ok: false, status: 422, error: "the replay doesn't reproduce that length" };
  }
  const previous = store.best(claim.player, claim.game, engineVersion);
  store.record({
    game: claim.game,
    engine: engineVersion,
    player: claim.player,
    score: claim.score,
    calm: claim.calm,
    durationMs: ticksToMs(replay.ticks),
    seed: claim.seed,
    traceHash: createHash("sha256").update(traceCanonical(claim.trace)).digest("hex"),
    day: dayOf(now),
  });
  const best = Math.max(previous ?? 0, claim.score);
  return {
    ok: true,
    body: {
      rank: store.rank(claim.game, engineVersion, best),
      isBest: previous === null || claim.score > previous,
      best,
      board: readBoard(store, claim.game, "all"),
    },
  };
}
