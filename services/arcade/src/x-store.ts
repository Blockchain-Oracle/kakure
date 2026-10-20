import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Sign in with X's book (plan §0 R7), in the arcade's SQLite file: which device key an X account named, as the handle
 * and a salted hash of the X id (the id itself is never kept), and the salt, made once at random and kept here.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS x_links (
  player TEXT PRIMARY KEY,
  id_hash TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
const SALT_BYTES = 32;

export class XStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
  }

  /** The salt X ids are hashed with, made on first use. */
  salt(): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE name = 'x_salt'").get() as
      | { value: string }
      | undefined;
    if (row) return row.value;
    const value = randomBytes(SALT_BYTES).toString("hex");
    this.db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES ('x_salt', ?)").run(value);
    return (this.db.prepare("SELECT value FROM settings WHERE name = 'x_salt'").get() as { value: string }).value;
  }

  /** The key an X account (by its hashed id) names, if any. */
  playerOf(idHash: string): string | null {
    const row = this.db.prepare("SELECT player FROM x_links WHERE id_hash = ?").get(idHash) as
      | { player: string }
      | undefined;
    return row?.player ?? null;
  }

  /** The handle a key signed in with, if it did. */
  handleOf(player: string): string | null {
    const row = this.db.prepare("SELECT handle FROM x_links WHERE player = ?").get(player) as
      | { handle: string }
      | undefined;
    return row?.handle ?? null;
  }

  link(player: string, idHash: string, handle: string): void {
    this.db
      .prepare(
        `INSERT INTO x_links (player, id_hash, handle) VALUES (?, ?, ?)
         ON CONFLICT(player) DO UPDATE SET id_hash = excluded.id_hash, handle = excluded.handle`,
      )
      .run(player, idHash, handle);
  }
}
