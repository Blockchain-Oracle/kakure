//! The engine database, `operator-data/<net>/engine.sqlite` (mode 0600).
//!
//! It holds markets (rules fixed at creation), every bet receipt and its classification
//! (including payout addresses, so it is a secret file), the address pool, and the publication
//! history. Everything survives restarts; each tick re-derives what it can from the wallet.

use std::{fs, os::unix::fs::PermissionsExt, path::Path};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    window TEXT NOT NULL,
    opens_at INTEGER NOT NULL,
    cutoff_at INTEGER NOT NULL,
    closes_at INTEGER NOT NULL,
    rules TEXT NOT NULL,
    rules_hash TEXT NOT NULL,
    target_height INTEGER,
    created_at INTEGER NOT NULL,
    -- Canonical JSON {venue: close}; set once when betting opens.
    opening TEXT,
    -- Set when fewer than 2 venues gave an opening reference: every ticket is refunded.
    cancelled INTEGER NOT NULL DEFAULT 0,
    cutoff_height INTEGER,
    released_seq INTEGER,
    released_count INTEGER,
    released_sides TEXT
);

-- One row per venue once that venue's opening candle is settled (close or no trades).
CREATE TABLE IF NOT EXISTS opening_quotes (
    market_id TEXT NOT NULL REFERENCES markets(id),
    venue TEXT NOT NULL,
    close TEXT,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (market_id, venue)
);

-- Every output received at a market address after it was published.
CREATE TABLE IF NOT EXISTS receipts (
    txid TEXT NOT NULL,
    pool INTEGER NOT NULL,
    output_index INTEGER NOT NULL,
    height INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    value_zat INTEGER NOT NULL,
    address_index INTEGER NOT NULL,
    -- ticket | refund | dust | unrecoverable
    status TEXT NOT NULL,
    reason TEXT,
    market_id TEXT,
    side TEXT,
    size_zat INTEGER,
    nonce TEXT,
    payout_address TEXT,
    leaf TEXT,
    first_seen INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (txid, pool, output_index)
);
CREATE INDEX IF NOT EXISTS receipts_market ON receipts (market_id, status);

-- Tickets a bundle has made public (PD28): a market's ticketCount, leaves and totals are exactly
-- these rows. Pending tickets join only in releases of MIN_NEW_TICKETS_PER_RELEASE or more.
CREATE TABLE IF NOT EXISTS released_tickets (
    market_id TEXT NOT NULL,
    leaf TEXT NOT NULL,
    side TEXT NOT NULL,
    size_zat INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (market_id, leaf)
);

CREATE TABLE IF NOT EXISTS addresses (
    idx INTEGER PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    added_list INTEGER NOT NULL,
    retired_list INTEGER,
    -- Scanned tip when the address was first published; earlier outputs are not bets.
    published_tip INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS address_lists (
    seq INTEGER PRIMARY KEY,
    file TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bundles (
    seq INTEGER PRIMARY KEY,
    file TEXT NOT NULL,
    hash TEXT NOT NULL,
    published_at INTEGER NOT NULL
);

-- Payouts and refunds: one row per canonical note, each its own transaction (plan §3, §13.1).
-- Txids stay here, never in a published file (PD16).
CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT,
    receipt_txid TEXT NOT NULL,
    receipt_pool INTEGER NOT NULL,
    receipt_index INTEGER NOT NULL,
    note_index INTEGER NOT NULL,
    -- win | refund
    kind TEXT NOT NULL,
    reason TEXT,
    recipient TEXT NOT NULL,
    amount_zat INTEGER NOT NULL,
    resolved_at INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    -- scheduled | broadcast | mined
    status TEXT NOT NULL,
    owner BLOB NOT NULL,
    txid TEXT,
    expiry_height INTEGER,
    inputs TEXT,
    fee_zat INTEGER,
    built_at INTEGER,
    mined_height INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    UNIQUE (receipt_txid, receipt_pool, receipt_index, note_index)
);
CREATE INDEX IF NOT EXISTS payouts_due ON payouts (status, due_at);

-- Fee and expiry shapes of recently fetched shielded transactions (plan §3).
CREATE TABLE IF NOT EXISTS tx_samples (
    height INTEGER NOT NULL,
    expiry_delta INTEGER NOT NULL,
    fee INTEGER,
    actions INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_samples_height ON tx_samples (height);

CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Primary-venue price path of each close market, for the daily history files (C9).
CREATE TABLE IF NOT EXISTS price_paths (
    market_id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    interval INTEGER NOT NULL,
    series TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS history_files (
    day TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Note merges (fixed timer, never triggered by a receipt).
CREATE TABLE IF NOT EXISTS merges (
    slot INTEGER PRIMARY KEY,
    txid TEXT,
    notes INTEGER,
    expiry_height INTEGER,
    created_at INTEGER NOT NULL
);

-- Files pushed to R2 (only when R2 is configured).
CREATE TABLE IF NOT EXISTS uploads (
    file TEXT PRIMARY KEY,
    uploaded_at INTEGER NOT NULL
);
";

pub struct Store {
    pub conn: Connection,
}

/// A market row.
#[derive(Clone, Debug)]
pub struct MarketRow {
    pub id: String,
    pub kind: String,
    pub subject: String,
    pub window: String,
    pub opens_at: i64,
    pub cutoff_at: i64,
    pub closes_at: i64,
    pub rules: String,
    pub rules_hash: String,
    pub target_height: Option<u32>,
    pub opening: Option<String>,
    pub cancelled: bool,
    pub cutoff_height: Option<u32>,
    /// The bundle whose release last changed the published tickets (`released_tickets`).
    pub released_seq: Option<u64>,
    pub cutoff_hash: Option<String>,
    pub bet_height_cap: Option<u32>,
    pub final_count: Option<u32>,
    pub final_sides: Option<String>,
    pub outcome: Option<String>,
    pub outcome_reason: Option<String>,
    pub resolution_file: Option<String>,
    pub resolved_at: Option<i64>,
    /// The payout window its signed rules state (`None`: created before it was stored, 2–6 h).
    pub payout_window: Option<(i64, i64)>,
}

const MARKET_COLUMNS: &str = "id, kind, subject, window, opens_at, cutoff_at, closes_at, rules, rules_hash,
     target_height, opening, cancelled, cutoff_height, released_seq, released_count, released_sides,
     cutoff_hash, bet_height_cap, final_count, final_sides, outcome, outcome_reason, resolution_file,
     resolved_at, payout_min_secs, payout_max_secs";

fn market_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<MarketRow> {
    Ok(MarketRow {
        id: r.get(0)?,
        kind: r.get(1)?,
        subject: r.get(2)?,
        window: r.get(3)?,
        opens_at: r.get(4)?,
        cutoff_at: r.get(5)?,
        closes_at: r.get(6)?,
        rules: r.get(7)?,
        rules_hash: r.get(8)?,
        target_height: r.get(9)?,
        opening: r.get(10)?,
        cancelled: r.get(11)?,
        cutoff_height: r.get(12)?,
        released_seq: r.get(13)?,
        // 14, 15: released_count and released_sides, kept for older databases only.
        cutoff_hash: r.get(16)?,
        bet_height_cap: r.get(17)?,
        final_count: r.get(18)?,
        final_sides: r.get(19)?,
        outcome: r.get(20)?,
        outcome_reason: r.get(21)?,
        resolution_file: r.get(22)?,
        resolved_at: r.get(23)?,
        payout_window: match (r.get(24)?, r.get(25)?) {
            (Some(min), Some(max)) => Some((min, max)),
            _ => None,
        },
    })
}

/// A classified receipt, as ingest writes it.
#[derive(Clone, Debug)]
pub struct Receipt {
    pub txid: String,
    pub pool: u8,
    pub output_index: u32,
    pub height: u32,
    pub tx_index: u32,
    pub value_zat: u64,
    pub address_index: u32,
    pub status: &'static str,
    pub reason: Option<String>,
    pub market_id: Option<String>,
    pub side: Option<String>,
    pub size_zat: Option<u64>,
    pub nonce: Option<String>,
    pub payout_address: Option<String>,
    pub leaf: Option<String>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let fresh = !path.exists();
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        if fresh {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        }
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA)?;
        // S03 columns on markets created by S02 builds.
        for (column, ty) in [
            ("cutoff_hash", "TEXT"),
            ("bet_height_cap", "INTEGER"),
            ("final_count", "INTEGER"),
            ("final_sides", "TEXT"),
            ("outcome", "TEXT"),
            ("outcome_reason", "TEXT"),
            ("resolution_file", "TEXT"),
            ("resolved_at", "INTEGER"),
            ("payout_min_secs", "INTEGER"),
            ("payout_max_secs", "INTEGER"),
        ] {
            let exists: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('markets') WHERE name = ?1",
                [column],
                |r| r.get(0),
            )?;
            if !exists {
                conn.execute_batch(&format!("ALTER TABLE markets ADD COLUMN {column} {ty}"))?;
            }
        }
        // Before PD28 every ticket was published in the next bundle, so all known tickets are public.
        conn.execute_batch(
            "INSERT OR IGNORE INTO released_tickets (market_id, leaf, side, size_zat, seq)
                 SELECT r.market_id, r.leaf, r.side, r.size_zat, COALESCE((SELECT MAX(seq) FROM bundles), 0)
                 FROM receipts r
                 WHERE r.status = 'ticket'
                   AND NOT EXISTS (SELECT 1 FROM state WHERE key = 'released_tickets_seeded');
             INSERT OR IGNORE INTO state (key, value) VALUES ('released_tickets_seeded', '1');",
        )?;
        Ok(Self { conn })
    }

    pub fn markets(&self) -> Result<Vec<MarketRow>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {MARKET_COLUMNS} FROM markets ORDER BY closes_at, id"
        ))?;
        let rows = stmt.query_map([], market_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn market_exists(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM markets WHERE id = ?1", [id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn opening_quotes(&self, market_id: &str) -> Result<Vec<(String, Option<String>)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT venue, close FROM opening_quotes WHERE market_id = ?1")?;
        let rows = stmt.query_map([market_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn put_quote(
        &self,
        market_id: &str,
        venue: &str,
        close: Option<&str>,
        now: i64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO opening_quotes (market_id, venue, close, fetched_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![market_id, venue, close, now],
        )?;
        Ok(())
    }

    pub fn set_opening(&self, market_id: &str, opening: Option<&str>) -> Result<()> {
        match opening {
            Some(json) => self.conn.execute(
                "UPDATE markets SET opening = ?2 WHERE id = ?1 AND opening IS NULL",
                params![market_id, json],
            )?,
            None => self.conn.execute(
                "UPDATE markets SET cancelled = 1 WHERE id = ?1 AND opening IS NULL",
                [market_id],
            )?,
        };
        Ok(())
    }

    /// The current address list: (index, address) for addresses published and not retired.
    pub fn live_addresses(&self) -> Result<Vec<(u32, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT idx, address FROM addresses WHERE retired_list IS NULL ORDER BY address",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Every address ever published: index → scanned tip at first publication.
    pub fn published_tips(&self) -> Result<std::collections::HashMap<u32, u32>> {
        let mut stmt = self
            .conn
            .prepare("SELECT idx, published_tip FROM addresses")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn next_address_index(&self) -> Result<Option<u32>> {
        Ok(self
            .conn
            .query_row("SELECT MAX(idx) + 1 FROM addresses", [], |r| r.get(0))?)
    }

    pub fn current_address_list(&self) -> Result<Option<(u64, String)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT seq, file FROM address_lists ORDER BY seq DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }

    pub fn last_bundle(&self) -> Result<Option<(u64, String, String)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT seq, file, hash FROM bundles ORDER BY seq DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    }

    /// Ticket rows of a market: (side, size, leaf).
    pub fn tickets(&self, market_id: &str) -> Result<Vec<(String, u64, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT side, size_zat, leaf FROM receipts WHERE market_id = ?1 AND status = 'ticket'",
        )?;
        let rows = stmt.query_map([market_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Released (public) tickets of a market: (side, size, leaf).
    pub fn released(&self, market_id: &str) -> Result<Vec<(String, u64, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT side, size_zat, leaf FROM released_tickets WHERE market_id = ?1 ORDER BY leaf",
        )?;
        let rows = stmt.query_map([market_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Address indices that have received any output that counts as a bet attempt.
    pub fn used_address_indices(&self) -> Result<Vec<u32>> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT address_index FROM receipts")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Counts per status, for `status`.
    pub fn receipt_counts(&self) -> Result<Vec<(String, Option<String>, u32)>> {
        let mut stmt = self.conn.prepare(
            "SELECT status, reason, COUNT(*) FROM receipts GROUP BY status, reason ORDER BY status",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn uploaded(&self, file: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM uploads WHERE file = ?1", [file], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn mark_uploaded(&self, file: &str, now: i64) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO uploads (file, uploaded_at) VALUES (?1, ?2)",
            params![file, now],
        )?;
        Ok(())
    }
}

pub fn insert_market(
    tx: &Transaction<'_>,
    m: &crate::catalog::NewMarket,
    now: i64,
) -> Result<bool> {
    let inserted = tx.execute(
        "INSERT OR IGNORE INTO markets (id, kind, subject, window, opens_at, cutoff_at, closes_at, rules,
             rules_hash, target_height, created_at, bet_height_cap, payout_min_secs, payout_max_secs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            m.id,
            m.kind.as_str(),
            m.subject,
            m.window,
            m.opens_at,
            m.cutoff_at,
            m.closes_at,
            m.rules,
            m.rules_hash,
            m.target_height,
            now,
            m.bet_height_cap,
            m.payout_window.min,
            m.payout_window.max
        ],
    )?;
    Ok(inserted == 1)
}

/// Replaces the receipt set with the freshly classified one (reorg-safe: outputs the wallet no
/// longer has disappear), keeping each receipt's first-seen time.
pub fn replace_receipts(tx: &Transaction<'_>, receipts: &[Receipt], now: i64) -> Result<()> {
    tx.execute_batch("CREATE TEMP TABLE IF NOT EXISTS seen (txid TEXT, pool INTEGER, output_index INTEGER); DELETE FROM seen;")?;
    {
        let mut upsert = tx.prepare(
            "INSERT INTO receipts (txid, pool, output_index, height, tx_index, value_zat, address_index, status,
                 reason, market_id, side, size_zat, nonce, payout_address, leaf, first_seen, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
             ON CONFLICT (txid, pool, output_index) DO UPDATE SET
                 height = excluded.height, tx_index = excluded.tx_index, value_zat = excluded.value_zat,
                 address_index = excluded.address_index, status = excluded.status, reason = excluded.reason,
                 market_id = excluded.market_id, side = excluded.side, size_zat = excluded.size_zat,
                 nonce = excluded.nonce, payout_address = excluded.payout_address, leaf = excluded.leaf,
                 updated_at = excluded.updated_at",
        )?;
        let mut seen = tx.prepare("INSERT INTO seen VALUES (?1, ?2, ?3)")?;
        for r in receipts {
            upsert.execute(params![
                r.txid,
                r.pool,
                r.output_index,
                r.height,
                r.tx_index,
                r.value_zat,
                r.address_index,
                r.status,
                r.reason,
                r.market_id,
                r.side,
                r.size_zat,
                r.nonce,
                r.payout_address,
                r.leaf,
                now
            ])?;
            seen.execute(params![r.txid, r.pool, r.output_index])?;
        }
    }
    tx.execute(
        "DELETE FROM receipts WHERE NOT EXISTS (SELECT 1 FROM seen s WHERE s.txid = receipts.txid
             AND s.pool = receipts.pool AND s.output_index = receipts.output_index)",
        [],
    )?;
    Ok(())
}

impl Store {
    /// Every receipt of a market: (txid, pool, index, status, reason, side, size, value, payout).
    pub fn market_receipts(&self, market_id: &str) -> Result<Vec<ReceiptRow>> {
        self.receipts_where("market_id = ?1", [market_id])
    }

    /// Refund receipts without any payout row yet.
    pub fn unscheduled_refunds(&self) -> Result<Vec<ReceiptRow>> {
        self.receipts_where(
            "status = 'refund' AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.receipt_txid = receipts.txid
                 AND p.receipt_pool = receipts.pool AND p.receipt_index = receipts.output_index)",
            [],
        )
    }

    fn receipts_where<P: rusqlite::Params>(
        &self,
        filter: &str,
        args: P,
    ) -> Result<Vec<ReceiptRow>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT txid, pool, output_index, status, reason, market_id, side, size_zat, value_zat, payout_address,
                 leaf, first_seen
             FROM receipts WHERE {filter} ORDER BY height, tx_index, pool, output_index"
        ))?;
        let rows = stmt.query_map(args, |r| {
            Ok(ReceiptRow {
                txid: r.get(0)?,
                pool: r.get(1)?,
                output_index: r.get(2)?,
                status: r.get(3)?,
                reason: r.get(4)?,
                market_id: r.get(5)?,
                side: r.get(6)?,
                size_zat: r.get(7)?,
                value_zat: r.get(8)?,
                payout_address: r.get(9)?,
                leaf: r.get(10)?,
                first_seen: r.get(11)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}

/// A stored receipt, as settlement reads it.
#[derive(Clone, Debug)]
pub struct ReceiptRow {
    pub txid: String,
    pub pool: u8,
    pub output_index: u32,
    pub status: String,
    pub reason: Option<String>,
    pub market_id: Option<String>,
    pub side: Option<String>,
    pub size_zat: Option<u64>,
    pub value_zat: u64,
    pub payout_address: Option<String>,
    pub leaf: Option<String>,
    /// The tick that first saw it (refund timing never keys off it directly: O20).
    pub first_seen: i64,
}
