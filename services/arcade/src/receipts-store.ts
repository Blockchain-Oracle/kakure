import type { DatabaseSync } from "node:sqlite";
import type { BetsRow } from "@kakure/arcade";

/**
 * Published receipts (plan §0 R7 under v2), in the arcade's SQLite file: the receipt id (a hash of the position's
 * lock, from the operator's token), the nickname's key, whether the call was right, the week it was published, and,
 * once taken back, the week it was. Never the Window, the side, the stake or a time. A receipt counts in the weeks
 * after it was published and before the week it was retracted in ends.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  receipt TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  right INTEGER NOT NULL,
  week INTEGER NOT NULL,
  retracted_week INTEGER
);
CREATE INDEX IF NOT EXISTS receipts_player ON receipts (player);
CREATE INDEX IF NOT EXISTS receipts_week ON receipts (week);
`;

/** The rows that count at the start of `week`: published before it and not retracted before it. */
const COUNTED = "r.week < :week AND (r.retracted_week IS NULL OR r.retracted_week >= :week)";

export class ReceiptStore {
  constructor(private readonly db: DatabaseSync) {
    // The first build kept a day and certificates' checks here; its rows were test calls, so the table starts over.
    const columns = db.prepare("PRAGMA table_info(receipts)").all() as Array<{ name: string }>;
    if (columns.length > 0 && !columns.some((c) => c.name === "week")) db.exec("DROP TABLE receipts;");
    db.exec(SCHEMA);
  }

  /** Who published a receipt, if anyone. */
  holder(receipt: string): string | null {
    const row = this.db.prepare("SELECT player FROM receipts WHERE receipt = ?").get(receipt) as
      | { player: string }
      | undefined;
    return row?.player ?? null;
  }

  /** Publishes, or, for a call taken back this same week, cancels the taking back (the board never saw either). */
  add(receipt: string, player: string, right: boolean, week: number): void {
    this.db
      .prepare(
        `INSERT INTO receipts (receipt, player, right, week) VALUES (?, ?, ?, ?)
         ON CONFLICT(receipt) DO UPDATE SET retracted_week = NULL WHERE player = excluded.player`,
      )
      .run(receipt, player, right ? 1 : 0, week);
  }

  /** Marks a receipt taken back as of `week`; false when this key has no such call still up. */
  retract(receipt: string, player: string, week: number): boolean {
    const changed = this.db
      .prepare("UPDATE receipts SET retracted_week = ? WHERE receipt = ? AND player = ? AND retracted_week IS NULL")
      .run(week, receipt, player);
    return Number(changed.changes) === 1;
  }

  /** Each key's right calls and calls counted at the start of `week`, published from `fromWeek`, `min` calls on. */
  board(fromWeek: number, week: number, min: number, limit: number): Array<BetsRow & { player: string }> {
    return (
      this.db
        .prepare(
          `SELECT r.player AS player, p.nickname AS nickname, SUM(r.right) AS right, COUNT(*) AS calls
           FROM receipts r JOIN players p ON p.player = r.player
           WHERE ${COUNTED} AND r.week >= :from GROUP BY r.player HAVING COUNT(*) >= :min
           ORDER BY right DESC, calls ASC, nickname ASC LIMIT :limit`,
        )
        .all({ week, from: fromWeek, min, limit }) as Array<{
        player: string;
        nickname: string;
        right: number;
        calls: number;
      }>
    ).map((r) => ({ player: r.player, nickname: r.nickname, right: r.right, calls: r.calls }));
  }

  /** One key's right calls and calls counted at the start of `week`. */
  tally(player: string, week: number): { right: number; calls: number } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(r.right), 0) AS right, COUNT(*) AS calls FROM receipts r
         WHERE r.player = :player AND ${COUNTED}`,
      )
      .get({ player, week }) as { right: number; calls: number };
    return { right: row.right, calls: row.calls };
  }

  /** The weekly clean-up: calls taken back before `week` leave for good. */
  sweep(week: number): void {
    this.db.prepare("DELETE FROM receipts WHERE retracted_week IS NOT NULL AND retracted_week < ?").run(week);
  }
}
