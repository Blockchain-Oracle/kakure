import { DurableObject } from "cloudflare:workers";
import { LATEST_FILE } from "./constants";

/** A file the Worker has already verified as signed by this network's operator. */
export interface VerifiedFile {
  name: string;
  body: ArrayBuffer;
  sha256: string;
  /** `latest.json` only: it must move forward. */
  seq: number | null;
  /** Files that must already be stored first, with the hash they must have when the document names one. */
  requires: Array<{ name: string; sha256: string | null }>;
}

export type WriteResult = "stored" | "unchanged" | "conflict" | "stale" | "missing";

interface FileRow extends Record<string, SqlStorageValue> {
  body: ArrayBuffer;
  sha256: string;
}

/**
 * The public files of one network (one object per network, `idFromName(network)`), in this object's SQLite.
 * Every file except `latest.json` is write-once. `latest.json` only moves to a higher `seq`, and only to a bundle
 * already stored with the hash it names, so a client can never be pointed at a missing or swapped bundle, and an
 * old signed `latest.json` can't be replayed to roll the market back (plan §13.11).
 */
export class DataStore extends DurableObject<object> {
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, body BLOB NOT NULL, sha256 TEXT NOT NULL, seq INTEGER)",
    );
  }

  read(name: string): FileRow | null {
    return (
      this.ctx.storage.sql.exec<FileRow>("SELECT body, sha256 FROM files WHERE name = ?", name).toArray()[0] ?? null
    );
  }

  /** Synchronous SQL inside one call: the object's input gate makes the checks and the write atomic. */
  write(file: VerifiedFile): WriteResult {
    for (const dependency of file.requires) {
      const stored = this.ctx.storage.sql
        .exec<{ sha256: string }>("SELECT sha256 FROM files WHERE name = ?", dependency.name)
        .toArray()[0];
      if (!stored || (dependency.sha256 !== null && stored.sha256 !== dependency.sha256)) return "missing";
    }
    const existing = this.ctx.storage.sql
      .exec<{ sha256: string; seq: number | null }>("SELECT sha256, seq FROM files WHERE name = ?", file.name)
      .toArray()[0];
    if (existing?.sha256 === file.sha256) return "unchanged";
    if (existing && file.name !== LATEST_FILE) return "conflict";
    if (existing && (file.seq === null || existing.seq === null || file.seq <= existing.seq)) return "stale";
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO files (name, body, sha256, seq) VALUES (?, ?, ?, ?)",
      file.name,
      file.body,
      file.sha256,
      file.seq,
    );
    return "stored";
  }
}
