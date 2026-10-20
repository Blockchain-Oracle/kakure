import type { DatabaseSync } from "node:sqlite";
import { type DuelCard, type DuelPick, INITIAL_RATING, type RatingRecord } from "@kakure/arcade";

/**
 * The Duel's book (plan §0 R5), in the arcade's SQLite file: the queue, the matches and the Elo ladder. A match keeps
 * its times only while it's live (for its deadlines); once it ends they go and only its day stays, as runs keep theirs.
 * Picks are stored only as commitments until both players reveal.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS duel_queue (
  player TEXT PRIMARY KEY,
  rating INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS duel_ratings (
  player TEXT PRIMARY KEY,
  rating INTEGER NOT NULL,
  verified INTEGER NOT NULL,
  won INTEGER NOT NULL,
  finished INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS duel_matches (
  id TEXT PRIMARY KEY,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  deck TEXT NOT NULL,
  status TEXT NOT NULL,
  pick_deadline INTEGER,
  reveal_deadline INTEGER,
  a_commit TEXT,
  b_commit TEXT,
  a_picks TEXT,
  b_picks TEXT,
  outcomes TEXT NOT NULL,
  winner INTEGER,
  a_delta INTEGER,
  b_delta INTEGER,
  a_rating INTEGER NOT NULL,
  b_rating INTEGER NOT NULL,
  day INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS duel_matches_a ON duel_matches (a, status);
CREATE INDEX IF NOT EXISTS duel_matches_b ON duel_matches (b, status);
`;

export type MatchStatus = "picking" | "revealing" | "settling" | "final" | "forfeit" | "void";
export type Outcome = "U" | "D" | "refund" | null;

export interface MatchRow {
  id: string;
  a: string;
  b: string;
  deck: DuelCard[];
  status: MatchStatus;
  pickDeadline: number | null;
  revealDeadline: number | null;
  commits: [string | null, string | null];
  picks: [DuelPick[] | null, DuelPick[] | null];
  outcomes: Outcome[];
  winner: 0 | 1 | null;
  deltas: [number | null, number | null];
  ratings: [number, number];
  day: number;
}

interface RawMatch {
  id: string;
  a: string;
  b: string;
  deck: string;
  status: string;
  pick_deadline: number | null;
  reveal_deadline: number | null;
  a_commit: string | null;
  b_commit: string | null;
  a_picks: string | null;
  b_picks: string | null;
  outcomes: string;
  winner: number | null;
  a_delta: number | null;
  b_delta: number | null;
  a_rating: number;
  b_rating: number;
  day: number;
}

const LIVE: readonly MatchStatus[] = ["picking", "revealing", "settling"];
const parse = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));

function toRow(r: RawMatch): MatchRow {
  return {
    id: r.id,
    a: r.a,
    b: r.b,
    deck: JSON.parse(r.deck) as DuelCard[],
    status: r.status as MatchStatus,
    pickDeadline: r.pick_deadline,
    revealDeadline: r.reveal_deadline,
    commits: [r.a_commit, r.b_commit],
    picks: [parse<DuelPick[]>(r.a_picks), parse<DuelPick[]>(r.b_picks)],
    outcomes: JSON.parse(r.outcomes) as Outcome[],
    winner: r.winner === 0 || r.winner === 1 ? r.winner : null,
    deltas: [r.a_delta, r.b_delta],
    ratings: [r.a_rating, r.b_rating],
    day: r.day,
  };
}

export class DuelStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
  }

  rating(player: string): RatingRecord & { won: number; finished: number } {
    const row = this.db
      .prepare("SELECT rating, verified, won, finished FROM duel_ratings WHERE player = ?")
      .get(player) as { rating: number; verified: number; won: number; finished: number } | undefined;
    return row ?? { rating: INITIAL_RATING, verified: 0, won: 0, finished: 0 };
  }

  saveRating(player: string, record: RatingRecord & { won: number; finished: number }): void {
    this.db
      .prepare(
        `INSERT INTO duel_ratings (player, rating, verified, won, finished) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(player) DO UPDATE SET rating = excluded.rating, verified = excluded.verified,
           won = excluded.won, finished = excluded.finished`,
      )
      .run(player, record.rating, record.verified, record.won, record.finished);
  }

  queue(): { player: string; rating: number; queuedAt: number }[] {
    return (
      this.db.prepare("SELECT player, rating, queued_at FROM duel_queue ORDER BY queued_at").all() as Array<{
        player: string;
        rating: number;
        queued_at: number;
      }>
    ).map((r) => ({ player: r.player, rating: r.rating, queuedAt: r.queued_at }));
  }

  enqueue(player: string, rating: number, nowSec: number): void {
    this.db
      .prepare("INSERT OR IGNORE INTO duel_queue (player, rating, queued_at, seen_at) VALUES (?, ?, ?, ?)")
      .run(player, rating, nowSec, nowSec);
  }

  /** A waiting player's poll keeps their place. */
  seen(player: string, nowSec: number): void {
    this.db.prepare("UPDATE duel_queue SET seen_at = ? WHERE player = ?").run(nowSec, player);
  }

  /** Drops whoever stopped polling: a closed tab is never paired. */
  dropSilent(sinceSec: number): void {
    this.db.prepare("DELETE FROM duel_queue WHERE seen_at < ?").run(sinceSec);
  }

  dequeue(player: string): void {
    this.db.prepare("DELETE FROM duel_queue WHERE player = ?").run(player);
  }

  /** The live match this key plays in, if any. */
  liveMatchOf(player: string): MatchRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM duel_matches WHERE (a = ? OR b = ?) AND status IN (${LIVE.map(() => "?").join(",")})
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(player, player, ...LIVE) as RawMatch | undefined;
    return row ? toRow(row) : null;
  }

  liveMatches(): MatchRow[] {
    return (
      this.db
        .prepare(`SELECT * FROM duel_matches WHERE status IN (${LIVE.map(() => "?").join(",")})`)
        .all(...LIVE) as unknown as RawMatch[]
    ).map(toRow);
  }

  match(id: string): MatchRow | null {
    const row = this.db.prepare("SELECT * FROM duel_matches WHERE id = ?").get(id) as RawMatch | undefined;
    return row ? toRow(row) : null;
  }

  create(m: MatchRow): void {
    this.db
      .prepare(
        `INSERT INTO duel_matches (id, a, b, deck, status, pick_deadline, reveal_deadline, outcomes, a_rating, b_rating, day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.a,
        m.b,
        JSON.stringify(m.deck),
        m.status,
        m.pickDeadline,
        m.revealDeadline,
        JSON.stringify(m.outcomes),
        m.ratings[0],
        m.ratings[1],
        m.day,
      );
  }

  /** Writes a match's changing fields; an ended match drops its times. */
  save(m: MatchRow): void {
    const live = LIVE.includes(m.status);
    this.db
      .prepare(
        `UPDATE duel_matches SET status = ?, pick_deadline = ?, reveal_deadline = ?, a_commit = ?, b_commit = ?,
           a_picks = ?, b_picks = ?, outcomes = ?, winner = ?, a_delta = ?, b_delta = ? WHERE id = ?`,
      )
      .run(
        m.status,
        live ? m.pickDeadline : null,
        live ? m.revealDeadline : null,
        m.commits[0],
        m.commits[1],
        m.picks[0] ? JSON.stringify(m.picks[0]) : null,
        m.picks[1] ? JSON.stringify(m.picks[1]) : null,
        JSON.stringify(m.outcomes),
        m.winner,
        m.deltas[0],
        m.deltas[1],
        m.id,
      );
  }

  board(limit: number): { player: string; rating: number; won: number; finished: number }[] {
    return this.db
      .prepare(
        "SELECT player, rating, won, finished FROM duel_ratings WHERE verified > 0 ORDER BY rating DESC, finished DESC LIMIT ?",
      )
      .all(limit) as Array<{ player: string; rating: number; won: number; finished: number }>;
  }

  recent(limit: number): MatchRow[] {
    return (
      this.db
        .prepare("SELECT * FROM duel_matches WHERE status IN ('final', 'forfeit') ORDER BY rowid DESC LIMIT ?")
        .all(limit) as unknown as RawMatch[]
    ).map(toRow);
  }

  history(player: string, limit: number): MatchRow[] {
    return (
      this.db
        .prepare("SELECT * FROM duel_matches WHERE a = ? OR b = ? ORDER BY rowid DESC LIMIT ?")
        .all(player, player, limit) as unknown as RawMatch[]
    ).map(toRow);
  }

  /** Runs `work` in one transaction (the queue pairing and a match's state change are each all or nothing). */
  atomically<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = work();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
