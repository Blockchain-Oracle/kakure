import { DatabaseSync } from "node:sqlite";
import type { ArcadeGame, BoardRow, Tape } from "@kakure/arcade";

/**
 * The arcade's book (Mitoshi `@cwf/db` arcade store, in one SQLite file): players (a device key and its nickname),
 * issued seeds with their tapes until they're posted or expire, accepted runs, and an hourly post count per player.
 * Nothing about a visitor: no IP (the service never receives one), no times beyond a run's day, and the hourly counts
 * leave as soon as their hour is over.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  player TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS seeds (
  seed TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  tape TEXT,
  issued_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  engine INTEGER NOT NULL,
  player TEXT NOT NULL,
  score INTEGER NOT NULL,
  calm INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  seed TEXT NOT NULL,
  trace_hash TEXT NOT NULL,
  day INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_board ON runs (game, engine, day, score);
CREATE TABLE IF NOT EXISTS posts (
  player TEXT NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (player, hour)
);
`;

export interface NewRun {
  game: ArcadeGame;
  engine: number;
  player: string;
  score: number;
  calm: boolean;
  durationMs: number;
  seed: string;
  traceHash: string;
  day: number;
}

export class ArcadeStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  nicknameOf(player: string): string | null {
    const row = this.db.prepare("SELECT nickname FROM players WHERE player = ?").get(player) as
      | { nickname: string }
      | undefined;
    return row?.nickname ?? null;
  }

  /** Claims `nickname` for `player` (a rename keeps the key); false when another key holds it, case folded. */
  claim(player: string, nickname: string): boolean {
    const key = nickname.toLowerCase();
    const holder = this.db.prepare("SELECT player FROM players WHERE nickname_key = ?").get(key) as
      | { player: string }
      | undefined;
    if (holder && holder.player !== player) return false;
    this.db
      .prepare(
        `INSERT INTO players (player, nickname, nickname_key) VALUES (?, ?, ?)
         ON CONFLICT(player) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key`,
      )
      .run(player, nickname, key);
    return true;
  }

  issue(seed: string, game: ArcadeGame, tape: Tape | null, nowSec: number, graceSec: number): boolean {
    this.db.prepare("DELETE FROM seeds WHERE issued_at < ?").run(nowSec - graceSec);
    const result = this.db
      .prepare("INSERT OR IGNORE INTO seeds (seed, game, tape, issued_at) VALUES (?, ?, ?, ?)")
      .run(seed, game, tape ? JSON.stringify(tape) : null, nowSec);
    return result.changes === 1;
  }

  /** The seed's tape, taken (one score per seed); undefined when it wasn't issued here for this game, or expired. */
  take(seed: string, game: ArcadeGame, nowSec: number, graceSec: number): Tape | null | undefined {
    const row = this.db.prepare("SELECT tape, issued_at FROM seeds WHERE seed = ? AND game = ?").get(seed, game) as
      | { tape: string | null; issued_at: number }
      | undefined;
    if (!row || row.issued_at < nowSec - graceSec) return undefined;
    this.db.prepare("DELETE FROM seeds WHERE seed = ?").run(seed);
    return row.tape === null ? null : (JSON.parse(row.tape) as Tape);
  }

  /** Counts a post against the player's hour; false past the limit. Earlier hours' counts are dropped. */
  allowPost(player: string, hour: number, limit: number): boolean {
    this.db.prepare("DELETE FROM posts WHERE hour < ?").run(hour);
    const row = this.db.prepare("SELECT count FROM posts WHERE player = ? AND hour = ?").get(player, hour) as
      | { count: number }
      | undefined;
    if ((row?.count ?? 0) >= limit) return false;
    this.db
      .prepare(
        `INSERT INTO posts (player, hour, count) VALUES (?, ?, 1)
         ON CONFLICT(player, hour) DO UPDATE SET count = count + 1`,
      )
      .run(player, hour);
    return true;
  }

  record(run: NewRun): void {
    this.db
      .prepare(
        `INSERT INTO runs (game, engine, player, score, calm, duration_ms, seed, trace_hash, day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.game,
        run.engine,
        run.player,
        run.score,
        run.calm ? 1 : 0,
        run.durationMs,
        run.seed,
        run.traceHash,
        run.day,
      );
  }

  best(player: string, game: ArcadeGame, engine: number): number | null {
    const row = this.db
      .prepare("SELECT MAX(score) AS best FROM runs WHERE player = ? AND game = ? AND engine = ?")
      .get(player, game, engine) as { best: number | null };
    return row.best;
  }

  /** Each player's best run since `sinceDay`, highest first (Mitoshi's board: one row per player). */
  board(game: ArcadeGame, engine: number, sinceDay: number, limit: number): BoardRow[] {
    const rows = this.db
      .prepare(
        `SELECT p.nickname AS nickname, b.score AS score, b.calm AS calm, b.day AS day FROM (
           SELECT player, score, calm, day,
             ROW_NUMBER() OVER (PARTITION BY player ORDER BY score DESC, id ASC) AS n
           FROM runs WHERE game = ? AND engine = ? AND day >= ?
         ) b JOIN players p ON p.player = b.player
         WHERE b.n = 1 ORDER BY b.score DESC, b.day ASC LIMIT ?`,
      )
      .all(game, engine, sinceDay, limit) as Array<{ nickname: string; score: number; calm: number; day: number }>;
    return rows.map((r) => ({ nickname: r.nickname, score: r.score, calm: r.calm === 1, day: r.day }));
  }

  /** 1 + the players whose best beats `score` on this board, all time. */
  rank(game: ArcadeGame, engine: number, score: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS above FROM (
           SELECT player, MAX(score) AS best FROM runs WHERE game = ? AND engine = ? GROUP BY player
         ) WHERE best > ?`,
      )
      .get(game, engine, score) as { above: number };
    return row.above + 1;
  }
}
