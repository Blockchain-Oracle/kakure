import type { DatabaseSync } from "node:sqlite";
import type { BetsRow } from "@kakure/arcade";

/**
 * Published receipts (plan §0 R7 under v2), in the arcade's SQLite file: the receipt id (a hash of the position's
 * lock), the nickname's key, whether the call was right, and the day it was published. Never the Window, the side,
 * the stake or a time.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  receipt TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  right INTEGER NOT NULL,
  day INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_player ON receipts (player);
CREATE INDEX IF NOT EXISTS receipts_day ON receipts (day);
`;

export class ReceiptStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
  }

  /** Who published a receipt, if anyone. */
  holder(receipt: string): string | null {
    const row = this.db.prepare("SELECT player FROM receipts WHERE receipt = ?").get(receipt) as
      | { player: string }
      | undefined;
    return row?.player ?? null;
  }

  add(receipt: string, player: string, right: boolean, day: number): void {
    this.db
      .prepare("INSERT OR IGNORE INTO receipts (receipt, player, right, day) VALUES (?, ?, ?, ?)")
      .run(receipt, player, right ? 1 : 0, day);
  }

  /** Takes a receipt off the board; false when this key never published it. */
  remove(receipt: string, player: string): boolean {
    return (
      Number(this.db.prepare("DELETE FROM receipts WHERE receipt = ? AND player = ?").run(receipt, player).changes) ===
      1
    );
  }

  /** Each key's right calls and calls published in `[fromDay, beforeDay)`, at least `min` calls, most right first. */
  board(fromDay: number, beforeDay: number, min: number, limit: number): Array<BetsRow & { player: string }> {
    return (
      this.db
        .prepare(
          `SELECT r.player AS player, p.nickname AS nickname, SUM(r.right) AS right, COUNT(*) AS calls
           FROM receipts r JOIN players p ON p.player = r.player
           WHERE r.day >= ? AND r.day < ? GROUP BY r.player HAVING COUNT(*) >= ?
           ORDER BY right DESC, calls ASC, nickname ASC LIMIT ?`,
        )
        .all(fromDay, beforeDay, min, limit) as Array<{
        player: string;
        nickname: string;
        right: number;
        calls: number;
      }>
    ).map((r) => ({ player: r.player, nickname: r.nickname, right: r.right, calls: r.calls }));
  }

  /** One key's right calls and calls published before `beforeDay`. */
  tally(player: string, beforeDay: number): { right: number; calls: number } {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(right), 0) AS right, COUNT(*) AS calls FROM receipts WHERE player = ? AND day < ?")
      .get(player, beforeDay) as { right: number; calls: number };
    return { right: row.right, calls: row.calls };
  }
}
