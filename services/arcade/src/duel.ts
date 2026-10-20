import { randomBytes } from "node:crypto";
import {
  applyDuelResult,
  applyForfeit,
  DUEL_DECK_SIZE,
  DUEL_PICK_SEC,
  DUEL_REVEAL_SEC,
  type DuelCandidate,
  type DuelCard,
  type DuelMatchView,
  type DuelScore,
  type DuelState,
  dealDuelDeck,
  duelCommitment,
  duelScore,
  findOpponent,
  PAIR_DAILY_MAX,
  QUEUE_MAX,
} from "@kakure/arcade";
import { type BundleV2, currentAndNext, LANES, windowPhase } from "@kakure/domain";
import { DUEL_OUTCOME_GRACE_SEC } from "./constants";
import { commitSchema, keySchema, revealSchema, signedRequest } from "./duel-requests";
import type { MatchRow, MatchStatus, Outcome } from "./duel-store";
import { pairKey } from "./duel-store";
import { view } from "./duel-views";
import { dayOf, type Verdict } from "./handlers";
import type { ArcadeStore } from "./store";
import { latestBundle, printedOutcomes } from "./tapes";
import { CONFLICT, NOT_FOUND, nowSec, refuse, UNAUTHORIZED, UNAVAILABLE, UNPROCESSABLE } from "./verdicts";

/**
 * The free Duel on the arcade service (plan §0 R5; Mitoshi's duel server, without the chain arena and its pots).
 * Queue → a deck of three live Windows dealt from the latest signed bundle → both players commit to their picks →
 * both reveal → each card is scored on its Window's signed outcome → Elo. A player who misses the pick or the reveal
 * deadline forfeits: their rating falls as for a loss and the opponent is credited the win without rating, so a
 * no-show can't be farmed. If both miss, the duel is void and moves nothing.
 *
 * Every change to a match is one `step`: one transaction on a fresh read, missed deadlines first, then the call, the
 * match saved before the answer. A result is applied only by the step whose guarded update ends the match, so Elo
 * moves once however many requests and ticks reach the same deadline. Nothing here awaits inside a transaction.
 */
const ID_BYTES = 16;
/** A waiting player polls every few seconds; one silent this long has left (closed the tab) and is dropped. */
const QUEUE_SILENT_SEC = 30;
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

const seatOf = (m: MatchRow, player: string): 0 | 1 | null => (m.a === player ? 0 : m.b === player ? 1 : null);

function stateOf(store: ArcadeStore, player: string): DuelState {
  const duels = store.duels;
  const queue = duels.queue();
  const rating = duels.rating(player).rating;
  const match = duels.playingMatchOf(player);
  const seat = match ? seatOf(match, player) : null;
  if (match && seat !== null) return { status: "paired", waiting: queue.length, rating, matchId: match.id, seat };
  const entry = queue.find((e) => e.player === player);
  if (entry) return { status: "waiting", waiting: queue.length, rating, waitedSec: nowSec() - entry.queuedAt };
  return { status: "idle", waiting: queue.length, rating };
}

/** `POST /duel/state`: where a key stands. Only its own signed poll keeps its place in the queue. */
export function duelState(store: ArcadeStore, raw: unknown): Verdict<DuelState> {
  const checked = signedRequest(keySchema, raw, "state");
  if (!checked.ok) return checked;
  const duels = store.duels;
  duels.seen(checked.req.player, nowSec());
  duels.dropSilent(nowSec() - QUEUE_SILENT_SEC);
  return { ok: true, body: stateOf(store, checked.req.player) };
}

/** Joins the queue and pairs at once when someone compatible waits and a deck can be dealt. */
export async function joinQueue(store: ArcadeStore, raw: unknown): Promise<Verdict<DuelState>> {
  const checked = signedRequest(keySchema, raw, "queue");
  if (!checked.ok) return checked;
  const { player } = checked.req;
  if (store.nicknameOf(player) === null) return refuse(UNAUTHORIZED, "pick a nickname first");
  const duels = store.duels;
  if (duels.playingMatchOf(player)) return { ok: true, body: stateOf(store, player) };
  const queue = duels.queue();
  if (!queue.some((e) => e.player === player) && queue.length >= QUEUE_MAX) {
    return refuse(UNAVAILABLE, "the queue is full; try again in a minute");
  }
  duels.enqueue(player, duels.rating(player).rating, nowSec());
  await pairQueue(store);
  return { ok: true, body: stateOf(store, player) };
}

export function leaveQueue(store: ArcadeStore, raw: unknown): Verdict<DuelState> {
  const checked = signedRequest(keySchema, raw, "leave");
  if (!checked.ok) return checked;
  store.duels.dequeue(checked.req.player);
  return { ok: true, body: stateOf(store, checked.req.player) };
}

/**
 * Pairs whoever can be paired, oldest first: each waiting key with its oldest compatible opponent it hasn't met
 * `PAIR_DAILY_MAX` times today, on a deck of three live Windows from the latest signed bundle. The bundle is fetched
 * first; the queue is read inside the transaction, so a join or a leave in between is never undone. Run on every join
 * and on the service's tick, so players who queued while no deck could be dealt are paired as soon as one can.
 */
export async function pairQueue(store: ArcadeStore): Promise<void> {
  const duels = store.duels;
  duels.dropSilent(nowSec() - QUEUE_SILENT_SEC);
  if (duels.queue().length < 2) return;
  const bundle = await latestBundle(Date.now()).catch(() => null);
  if (!bundle) return;
  duels.atomically(() => {
    const now = nowSec();
    const deck = dealDuelDeck(candidatesOf(bundle, now), now, bundle.pricing.entryBufferSec);
    if (deck.length !== DUEL_DECK_SIZE) return;
    const cards: DuelCard[] = deck.map((c) => ({
      window: c.id,
      asset: c.asset,
      intervalSec: c.intervalSec,
      expirySec: c.expirySec,
    }));
    const day = dayOf(now);
    const met = duels.meetingsOn(day);
    const queue = duels.queue();
    const taken = new Set<string>();
    for (const self of queue) {
      if (taken.has(self.player)) continue;
      const open = queue.filter(
        (e) => !taken.has(e.player) && (met.get(pairKey(self.player, e.player)) ?? 0) < PAIR_DAILY_MAX,
      );
      const opponent = findOpponent(self, open, now);
      if (!opponent) continue;
      taken.add(self.player);
      taken.add(opponent.player);
      // The one who waited longer is seat A.
      const [a, b] = self.queuedAt <= opponent.queuedAt ? [self, opponent] : [opponent, self];
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
        day,
      });
    }
  });
}

/**
 * One change to a match by one of its players, in one transaction on a fresh read: missed deadlines first, then `act`.
 * The match is saved whenever it changed, before the answer, so a refusal never leaves half a step behind.
 */
function step<T>(
  store: ArcadeStore,
  matchId: string,
  player: string,
  act: (m: MatchRow, seat: 0 | 1, now: number) => Verdict<T>,
): Verdict<T> {
  const duels = store.duels;
  return duels.atomically(() => {
    const m = duels.match(matchId);
    const seat = m ? seatOf(m, player) : null;
    if (!m || seat === null) return refuse<T>(NOT_FOUND, "no such duel of yours");
    const now = nowSec();
    const before = JSON.stringify(m);
    advance(store, m, now);
    const verdict = act(m, seat, now);
    if (JSON.stringify(m) !== before) duels.save(m);
    return verdict;
  });
}

export function commitPicks(store: ArcadeStore, raw: unknown): Verdict<DuelMatchView> {
  const checked = signedRequest(commitSchema, raw, "commit");
  if (!checked.ok) return checked;
  const req = checked.req;
  return step(store, req.matchId, req.player, (m, seat, now) => {
    if (m.status !== "picking") return refuse(CONFLICT, "the picks are closed");
    if (m.commits[seat] === null) m.commits[seat] = req.commitment;
    if (m.commits[0] && m.commits[1]) {
      m.status = "revealing";
      m.revealDeadline = now + DUEL_REVEAL_SEC;
    }
    return { ok: true, body: view(store, m, now) };
  });
}

export function revealPicks(store: ArcadeStore, raw: unknown): Verdict<DuelMatchView> {
  const checked = signedRequest(revealSchema, raw, "reveal");
  if (!checked.ok) return checked;
  const req = checked.req;
  return step(store, req.matchId, req.player, (m, seat, now) => {
    if (m.status !== "revealing") return refuse(CONFLICT, "it isn't time to reveal");
    const got = duelCommitment({ matchId: m.id, player: req.player, picks: req.picks, salt: req.salt });
    if (m.commits[seat] !== got) return refuse(UNPROCESSABLE, "the picks don't match your commitment");
    m.picks[seat] = req.picks;
    if (m.picks[0] && m.picks[1]) m.status = "settling";
    return { ok: true, body: view(store, m, now) };
  });
}

type Ending = { kind: "void" } | { kind: "score"; scoreForA: DuelScore } | { kind: "forfeit"; absent: 0 | 1 };

/** Ends a match. Its result moves the ladder only when this call is the one that took it out of a live status. */
function finish(store: ArcadeStore, m: MatchRow, status: MatchStatus, ending: Ending): void {
  m.status = status;
  m.pickDeadline = null;
  m.revealDeadline = null;
  const duels = store.duels;
  if (!duels.end(m.id, status) || ending.kind === "void") return;
  const players = [m.a, m.b] as const;
  const before = [duels.rating(m.a), duels.rating(m.b)] as const;
  let after: [(typeof before)[0], (typeof before)[1]];
  let wins: [number, number];
  if (ending.kind === "score") {
    const next = applyDuelResult(before[0], before[1], ending.scoreForA);
    after = [
      { ...before[0], ...next.a },
      { ...before[1], ...next.b },
    ];
    wins = [ending.scoreForA === 1 ? 1 : 0, ending.scoreForA === 0 ? 1 : 0];
    m.winner = ending.scoreForA === 1 ? 0 : ending.scoreForA === 0 ? 1 : null;
  } else {
    const present = ending.absent === 0 ? 1 : 0;
    const next = applyForfeit(before[ending.absent], before[present]);
    after = [before[0], before[1]];
    after[ending.absent] = { ...before[ending.absent], ...next.absent };
    wins = [present === 0 ? 1 : 0, present === 1 ? 1 : 0];
    m.winner = present;
  }
  for (const seat of [0, 1] as const) {
    duels.saveRating(players[seat], {
      ...after[seat],
      won: before[seat].won + wins[seat],
      finished: before[seat].finished + 1,
    });
  }
  m.deltas = [after[0].rating - before[0].rating, after[1].rating - before[1].rating];
}

/** The deadline a live match has passed, if any. */
const overdue = (m: MatchRow, now: number): boolean =>
  (m.status === "picking" && m.pickDeadline !== null && now > m.pickDeadline) ||
  (m.status === "revealing" && m.revealDeadline !== null && now > m.revealDeadline);

/** Moves a match past a deadline it has missed: one side in is a forfeit by the other, neither is a void. */
function advance(store: ArcadeStore, m: MatchRow, now: number): void {
  if (!overdue(m, now)) return;
  const done =
    m.status === "picking"
      ? [m.commits[0] !== null, m.commits[1] !== null]
      : [m.picks[0] !== null, m.picks[1] !== null];
  if (done[0] === done[1]) finish(store, m, "void", { kind: "void" });
  else finish(store, m, "forfeit", { kind: "forfeit", absent: done[0] ? 1 : 0 });
}

/**
 * The tick: each live match past its deadlines, and each settling card's signed outcome, from the latest bundle or, once
 * its Window has left the bundle's ten-minute list, from its hour's prints file. Every read from the site happens
 * first; the matches are then read and changed inside one transaction.
 */
export async function settleDuels(store: ArcadeStore): Promise<void> {
  const duels = store.duels;
  if (!duels.anyLive()) return;
  const bundle = await latestBundle(Date.now()).catch(() => null);
  const known = new Map<string, Outcome>();
  for (const w of bundle?.windows ?? []) if (w.outcome) known.set(w.id, w.outcome);
  const closedBefore = nowSec();
  const missing = duels
    .liveMatches()
    .filter((m) => m.status === "settling")
    .flatMap((m) => m.deck.filter((card, i) => m.outcomes[i] === null && card.expirySec < closedBefore))
    .filter((card) => !known.has(card.window))
    .map((card) => ({ id: card.window, expirySec: card.expirySec }));
  if (bundle && missing.length > 0) {
    for (const [id, outcome] of await printedOutcomes(bundle, missing).catch(() => new Map())) known.set(id, outcome);
  }
  duels.atomically(() => {
    const now = nowSec();
    for (const m of duels.liveMatches()) {
      const before = JSON.stringify(m);
      advance(store, m, now);
      if (m.status === "settling") {
        m.outcomes = m.deck.map((card, i) => {
          const outcome = m.outcomes[i] ?? known.get(card.window) ?? null;
          return outcome === null && now > card.expirySec + DUEL_OUTCOME_GRACE_SEC ? "refund" : outcome;
        });
        if (m.outcomes.every((o) => o !== null)) {
          const result = duelScore(m.picks[0] ?? [], m.picks[1] ?? [], m.outcomes as ("U" | "D" | "refund")[]);
          if (result.score === null) finish(store, m, "void", { kind: "void" });
          else finish(store, m, "final", { kind: "score", scoreForA: result.score });
        }
      }
      if (JSON.stringify(m) !== before) duels.save(m);
    }
  });
}

/** A match as anyone may see it; picks show only once both are revealed. A missed deadline is applied on the way. */
export function matchView(store: ArcadeStore, id: string): DuelMatchView | null {
  const duels = store.duels;
  const m = duels.match(id);
  if (!m) return null;
  if (!overdue(m, nowSec())) return view(store, m, nowSec());
  return duels.atomically(() => {
    const fresh = duels.match(id);
    if (!fresh) return null;
    advance(store, fresh, nowSec());
    duels.save(fresh);
    return view(store, fresh, nowSec());
  });
}
