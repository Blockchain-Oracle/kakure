import {
  type DuelBoardRow,
  type DuelHistoryRow,
  type DuelMatchView,
  type DuelRecent,
  RANK_LIMIT,
} from "@kakure/arcade";
import { keySchema, signedRequest } from "./duel-requests";
import { isLive, type MatchRow } from "./duel-store";
import type { Verdict } from "./handlers";
import type { ArcadeStore } from "./store";

/**
 * What the Duel shows: a match as anyone may see it (picks only once both are revealed), the Elo ladder, the last
 * decided duels and a key's own history. Nicknames, results and days only.
 */
const RECENT_LIMIT = 10;
const HISTORY_LIMIT = 20;

export function view(store: ArcadeStore, m: MatchRow, now: number): DuelMatchView {
  const open = m.picks[0] !== null && m.picks[1] !== null;
  const decided = m.outcomes.map((o) => (o === "U" || o === "D" ? o : null));
  const right = (seat: 0 | 1) =>
    open ? decided.filter((o, i) => o !== null && (m.picks[seat]?.[i] === "up") === (o === "U")).length : 0;
  const seat = (s: 0 | 1) => ({
    nickname: store.nicknameOf(s === 0 ? m.a : m.b) ?? "—",
    rating: m.ratings[s],
    committed: m.commits[s] !== null,
    revealed: m.picks[s] !== null,
    picks: open ? (m.picks[s] ?? null) : null,
    right: right(s),
    delta: m.deltas[s],
  });
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

/** `POST /duel/history` (signed): this key's duels, newest first. */
export function duelHistory(store: ArcadeStore, raw: unknown): Verdict<DuelHistoryRow[]> {
  const checked = signedRequest(keySchema, raw, "history");
  if (!checked.ok) return checked;
  const player = checked.req.player;
  const rows = store.duels.history(player, HISTORY_LIMIT).map((m) => {
    const seat = m.a === player ? 0 : 1;
    const result = isLive(m.status)
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
    } satisfies DuelHistoryRow;
  });
  return { ok: true, body: rows };
}

export const isMatchId = (value: string): boolean => /^[0-9a-f]{32}$/.test(value);
