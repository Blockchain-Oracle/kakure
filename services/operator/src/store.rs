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
    pub released_seq: Option<u64>,
    pub released_count: Option<u32>,
    pub released_sides: Option<String>,
}

const MARKET_COLUMNS: &str = "id, kind, subject, window, opens_at, cutoff_at, closes_at, rules, rules_hash,
     target_height, opening, cancelled, cutoff_height, released_seq, released_count, released_sides";

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
        released_count: r.get(14)?,
        released_sides: r.get(15)?,
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
             rules_hash, target_height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
            now
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
