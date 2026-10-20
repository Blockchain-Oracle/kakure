import { randomBytes } from "node:crypto";
import {
  applyDuelResult,
  DUEL_CLOCK_SKEW_SEC,
  DUEL_DECK_SIZE,
  DUEL_PICK_SEC,
  DUEL_REVEAL_SEC,
  type DuelBoardRow,
  type DuelCandidate,
  type DuelCard,
  type DuelHistoryRow,
  type DuelMatchView,
  type DuelRecent,
  type DuelScore,
  type DuelState,
  dealDuelDeck,
  duelCommitment,
  duelScore,
  findOpponent,
  RANK_LIMIT,
} from "@kakure/arcade";
import { type BundleV2, currentAndNext, LANES, windowPhase } from "@kakure/domain";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import type { MatchRow, MatchStatus, Outcome } from "./duel-store";
import { dayOf, type Verdict } from "./handlers";
import type { ArcadeStore } from "./store";
import { latestBundle } from "./tapes";

/**
 * The free Duel on the arcade service (plan §0 R5; Mitoshi's duel server, without the chain arena and its pots).
 * Queue → a deck of three live Windows dealt from the latest signed bundle → both players commit to their picks →
 * both reveal → each card is scored on its Window's signed outcome → Elo. A player who misses the pick or the reveal
 * deadline forfeits (a real result); if both miss, the duel is void and moves nothing.
 */
const MS = 1000;
const ID_BYTES = 16;
const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_COMMIT = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32,128}$/;
const RECENT_LIMIT = 10;
const HISTORY_LIMIT = 20;
/** A card whose Window never shows an outcome this long after its close counts as a refund (the service was away). */
const OUTCOME_GRACE_SEC = 3_600;
/** A waiting player polls every few seconds; one silent this long has left (closed the tab) and is dropped. */
const QUEUE_SILENT_SEC = 30;
const nowSec = () => Math.floor(Date.now() / MS);
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CONFLICT = 409;
const UNPROCESSABLE = 422;

const signed = (document: Record<string, unknown>, player: string) => verifyDocument(document, hexToBytes(player));
const fresh = (at: number) => Math.abs(nowSec() - at) <= DUEL_CLOCK_SKEW_SEC;
const refuse = <T>(status: number, error: string): Verdict<T> => ({ ok: false, status, error });

const queueSchema = z.object({ player: z.string().regex(HEX_KEY), at: z.number().int(), sig: z.string() });
const commitSchema = z.object({
  player: z.string().regex(HEX_KEY),
  matchId: z.string(),
  commitment: z.string().regex(HEX_COMMIT),
  at: z.number().int(),
  sig: z.string(),
});
const revealSchema = z.object({
  player: z.string().regex(HEX_KEY),
  matchId: z.string(),
  picks: z.array(z.enum(["up", "down"])).length(DUEL_DECK_SIZE),
  salt: z.string().regex(SALT),
  at: z.number().int(),
  sig: z.string(),
});

/** Every Window the bundle lists as trading now, as the dealer reads it. */
function candidatesOf(bundle: BundleV2, now: number): DuelCandidate[] {
  const states = new Map(bundle.windows.map((w) => [w.id, w]));
  return LANES.flatMap((lane) =>
    currentAndNext(lane, now).map((window) => ({
      id: window.id,
      asset: lane.asset,
      intervalSec: lane.cadenceSec,
      expirySec: window.expirySec,
      trading: windowPhase(window, states.get(window.id) ?? null, now) === "live",
    })),
  );
}

export function duelState(store: ArcadeStore, player: string): DuelState {
  const duels = store.duels;
  duels.seen(player, nowSec());
  duels.dropSilent(nowSec() - QUEUE_SILENT_SEC);
  const waiting = duels.queue().length;
  const rating = duels.rating(player).rating;
  const match = duels.liveMatchOf(player);
  if (match) return { status: "paired", waiting, rating, matchId: match.id };
  const entry = duels.queue().find((e) => e.player === player);
  if (entry) return { status: "waiting", waiting, rating, waitedSec: nowSec() - entry.queuedAt };
  return { status: "idle", waiting, rating };
}

/** Joins the queue and pairs at once when someone compatible waits and a deck can be dealt. */
export async function joinQueue(store: ArcadeStore, raw: unknown): Promise<Verdict<DuelState>> {
  const parsed = queueSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a queue request");
  const req = parsed.data;
  if (!signed(req, req.player)) return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  if (!fresh(req.at)) return refuse(BAD_REQUEST, "the request is stale; try again");
  if (store.nicknameOf(req.player) === null) return refuse(UNAUTHORIZED, "pick a nickname first");
  const duels = store.duels;
  if (duels.liveMatchOf(req.player)) return { ok: true, body: duelState(store, req.player) };
  duels.enqueue(req.player, duels.rating(req.player).rating, nowSec());
  await pairQueue(store);
  return { ok: true, body: duelState(store, req.player) };
}

/**
 * Pairs whoever can be paired: the longest-waiting entry with its oldest compatible opponent, again and again, each
 * pair on a deck of three live Windows from the latest signed bundle. Run on every join and on the service's tick, so
 * two players who queued while no deck could be dealt (the top of the hour, when every new Window is still opening)
 * are paired as soon as one can.
 */
export async function pairQueue(store: ArcadeStore): Promise<void> {
  const duels = store.duels;
  duels.dropSilent(nowSec() - QUEUE_SILENT_SEC);
  if (duels.queue().length < 2) return;
  const now = nowSec();
  const bundle = await latestBundle(Date.now()).catch(() => null);
  const deck = bundle ? dealDuelDeck(candidatesOf(bundle, now), now, bundle.pricing.entryBufferSec) : [];
  if (deck.length !== DUEL_DECK_SIZE) return;
  const cards: DuelCard[] = deck.map((c) => ({
    window: c.id,
    asset: c.asset,
    intervalSec: c.intervalSec,
    expirySec: c.expirySec,
  }));
  duels.atomically(() => {
    for (;;) {
      const queue = duels.queue();
      const pair = queue
        .map((self) => ({ self, opponent: findOpponent(self, queue, now) }))
        .find((p) => p.opponent !== null);
      if (!pair?.opponent) return;
      // The one who waited longer is seat A.
      const [a, b] =
        pair.self.queuedAt <= pair.opponent.queuedAt ? [pair.self, pair.opponent] : [pair.opponent, pair.self];
      duels.dequeue(a.player);
      duels.dequeue(b.player);
      duels.create({
        id: randomBytes(ID_BYTES).toString("hex"),
        a: a.player,
        b: b.player,
        deck: cards,
        status: "picking",
        pickDeadline: now + DUEL_PICK_SEC,
        revealDeadline: null,
        commits: [null, null],
        picks: [null, null],
        outcomes: cards.map(() => null),
        winner: null,
        deltas: [null, null],
        ratings: [a.rating, b.rating],
        day: dayOf(now),
      });
    }
  });
}

export function leaveQueue(store: ArcadeStore, raw: unknown): Verdict<DuelState> {
  const parsed = queueSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a queue request");
  const req = parsed.data;
  if (!signed(req, req.player)) return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  if (!fresh(req.at)) return refuse(BAD_REQUEST, "the request is stale; try again");
  store.duels.dequeue(req.player);
  return { ok: true, body: duelState(store, req.player) };
}

const seatOf = (m: MatchRow, player: string): 0 | 1 | null => (m.a === player ? 0 : m.b === player ? 1 : null);

export function commitPicks(store: ArcadeStore, raw: unknown): Verdict<DuelMatchView> {
  const parsed = commitSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a commitment");
  const req = parsed.data;
  if (!signed(req, req.player)) return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  if (!fresh(req.at)) return refuse(BAD_REQUEST, "the request is stale; try again");
  const duels = store.duels;
  return duels.atomically(() => {
    const m = duels.match(req.matchId);
    const seat = m ? seatOf(m, req.player) : null;
    if (!m || seat === null) return refuse<DuelMatchView>(NOT_FOUND, "no such duel of yours");
    advance(store, m, nowSec());
    if (m.status !== "picking") return refuse<DuelMatchView>(CONFLICT, "the picks are closed");
    if (m.commits[seat] === null) m.commits[seat] = req.commitment;
    if (m.commits[0] && m.commits[1]) {
      m.status = "revealing";
      m.revealDeadline = nowSec() + DUEL_REVEAL_SEC;
    }
    duels.save(m);
    return { ok: true, body: view(store, m, nowSec()) };
  });
}

export function revealPicks(store: ArcadeStore, raw: unknown): Verdict<DuelMatchView> {
  const parsed = revealSchema.safeParse(raw);
  if (!parsed.success) return refuse(BAD_REQUEST, "that isn't a reveal");
  const req = parsed.data;
  if (!signed(req, req.player)) return refuse(UNAUTHORIZED, "the request isn't signed by its key");
  if (!fresh(req.at)) return refuse(BAD_REQUEST, "the request is stale; try again");
  const duels = store.duels;
  return duels.atomically(() => {
    const m = duels.match(req.matchId);
    const seat = m ? seatOf(m, req.player) : null;
    if (!m || seat === null) return refuse<DuelMatchView>(NOT_FOUND, "no such duel of yours");
    advance(store, m, nowSec());
    if (m.status !== "revealing") return refuse<DuelMatchView>(CONFLICT, "it isn't time to reveal");
    const expected = m.commits[seat];
    const got = duelCommitment({ matchId: m.id, player: req.player, picks: req.picks, salt: req.salt });
    if (expected !== got) return refuse<DuelMatchView>(UNPROCESSABLE, "the picks don't match your commitment");
    m.picks[seat] = req.picks;
    if (m.picks[0] && m.picks[1]) m.status = "settling";
    duels.save(m);
    return { ok: true, body: view(store, m, nowSec()) };
  });
}

/** Ends a match with a score for seat A (null: void, nothing moves), applying Elo to both. */
function finish(store: ArcadeStore, m: MatchRow, status: MatchStatus, scoreForA: DuelScore | null): void {
  m.status = status;
  m.pickDeadline = null;
  m.revealDeadline = null;
  if (scoreForA === null) {
    m.winner = null;
    return;
  }
  const duels = store.duels;
  const a = duels.rating(m.a);
  const b = duels.rating(m.b);
  const next = applyDuelResult(a, b, scoreForA);
  const won = (score: number) => (score === 1 ? 1 : 0);
  duels.saveRating(m.a, { ...next.a, won: a.won + won(scoreForA), finished: a.finished + 1 });
  duels.saveRating(m.b, { ...next.b, won: b.won + won(1 - scoreForA), finished: b.finished + 1 });
  m.deltas = [next.a.rating - a.rating, next.b.rating - b.rating];
  m.winner = scoreForA === 1 ? 0 : scoreForA === 0 ? 1 : null;
}

/** Moves a match past any deadline it has missed. Outcomes are read separately (`settleDuels`). */
function advance(store: ArcadeStore, m: MatchRow, now: number): void {
  if (m.status === "picking" && m.pickDeadline !== null && now > m.pickDeadline) {
    const [a, b] = [m.commits[0] !== null, m.commits[1] !== null];
    finish(store, m, a !== b ? "forfeit" : "void", a !== b ? (a ? 1 : 0) : null);
  } else if (m.status === "revealing" && m.revealDeadline !== null && now > m.revealDeadline) {
    const [a, b] = [m.picks[0] !== null, m.picks[1] !== null];
    finish(store, m, a !== b ? "forfeit" : "void", a !== b ? (a ? 1 : 0) : null);
  }
}

/** Reads each settling card's outcome from the latest signed bundle and ends the duels whose cards have all decided. */
export async function settleDuels(store: ArcadeStore): Promise<void> {
  const duels = store.duels;
  const live = duels.liveMatches();
  if (live.length === 0) return;
  const now = nowSec();
  const bundle = await latestBundle(Date.now()).catch(() => null);
  const outcomeOf = new Map((bundle?.windows ?? []).map((w) => [w.id, (w.outcome ?? null) as Outcome]));
  duels.atomically(() => {
    for (const m of live) {
      advance(store, m, now);
      if (m.status === "settling") {
        m.outcomes = m.deck.map((card, i) => {
          const known = m.outcomes[i] ?? outcomeOf.get(card.window) ?? null;
          return known === null && now > card.expirySec + OUTCOME_GRACE_SEC ? "refund" : known;
        });
        if (m.outcomes.every((o) => o !== null)) {
          const result = duelScore(m.picks[0] ?? [], m.picks[1] ?? [], m.outcomes as ("U" | "D" | "refund")[]);
          finish(store, m, result.score === null ? "void" : "final", result.score);
        }
      }
      duels.save(m);
    }
  });
}

function view(store: ArcadeStore, m: MatchRow, now: number): DuelMatchView {
  const open = m.picks[0] !== null && m.picks[1] !== null;
  const decided = m.outcomes.map((o) => (o === "U" || o === "D" ? o : null));
  const right = (seat: 0 | 1) =>
    open ? decided.filter((o, i) => o !== null && (m.picks[seat]?.[i] === "up") === (o === "U")).length : 0;
  const seat = (s: 0 | 1) => {
    const player = s === 0 ? m.a : m.b;
    return {
      nickname: store.nicknameOf(player) ?? "—",
      rating: m.ratings[s],
      committed: m.commits[s] !== null,
      revealed: m.picks[s] !== null,
      picks: open ? (m.picks[s] ?? null) : null,
      right: right(s),
      delta: m.deltas[s],
    };
  };
  return {
    id: m.id,
    status: m.status,
    deck: m.deck,
    outcomes: m.outcomes,
    seats: [seat(0), seat(1)],
    pickLeftSec: m.status === "picking" && m.pickDeadline !== null ? Math.max(0, m.pickDeadline - now) : null,
    revealLeftSec: m.status === "revealing" && m.revealDeadline !== null ? Math.max(0, m.revealDeadline - now) : null,
    winner: m.winner,
    day: m.day,
  };
}

/** A match as anyone may see it; picks show only once both are revealed. Deadlines are applied on the way. */
export function matchView(store: ArcadeStore, id: string): DuelMatchView | null {
  const duels = store.duels;
  return duels.atomically(() => {
    const m = duels.match(id);
    if (!m) return null;
    advance(store, m, nowSec());
    duels.save(m);
    return view(store, m, nowSec());
  });
}

export function duelBoard(store: ArcadeStore, limit = RANK_LIMIT): DuelBoardRow[] {
  return store.duels.board(limit).map((r) => ({
    nickname: store.nicknameOf(r.player) ?? "—",
    rating: r.rating,
    won: r.won,
    finished: r.finished,
  }));
}

export function duelRecent(store: ArcadeStore): DuelRecent[] {
  return store.duels.recent(RECENT_LIMIT).map((m) => ({
    a: store.nicknameOf(m.a) ?? "—",
    b: store.nicknameOf(m.b) ?? "—",
    winner: m.winner === null ? null : (store.nicknameOf(m.winner === 0 ? m.a : m.b) ?? "—"),
    status: m.status,
    day: m.day,
  }));
}

export function duelHistory(store: ArcadeStore, player: string): DuelHistoryRow[] {
  return store.duels.history(player, HISTORY_LIMIT).map((m) => {
    const seat = m.a === player ? 0 : 1;
    const live = m.status === "picking" || m.status === "revealing" || m.status === "settling";
    const result = live
      ? "live"
      : m.status === "void"
        ? "void"
        : m.winner === null
          ? "draw"
          : m.winner === seat
            ? "won"
            : "lost";
    return {
      matchId: m.id,
      opponent: store.nicknameOf(seat === 0 ? m.b : m.a) ?? "—",
      result,
      delta: m.deltas[seat],
      day: m.day,
    };
  });
}

export const isMatchId = (value: string): boolean => /^[0-9a-f]{32}$/.test(value);
export const isPlayer = (value: string): boolean => HEX_KEY.test(value);
