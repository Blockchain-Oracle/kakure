//! The real-time market's tables in `engine.sqlite` (plan §00 REVAMP 2): every venue's committed
//! 1-minute closes, every Window's prints and outcome, and the hourly prints files. They sit beside
//! the pool engine's tables, on the same connection, so the bundle sequence carries on across the
//! cut-over.

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value};

use crate::{lanes::LaneWindow, minutes::VenueMinutes, settle::Prints, venues::Candle};

const SCHEMA: &str = "
-- One venue's committed 1-minute candle: its close, or NULL when the minute had no trades.
CREATE TABLE IF NOT EXISTS minute_closes (
    asset TEXT NOT NULL,
    venue TEXT NOT NULL,
    start INTEGER NOT NULL,
    close TEXT,
    PRIMARY KEY (asset, venue, start)
);

-- Real-time Windows: the opening and closing prints (canonical JSON venue → close | null), the
-- reference line, the outcome (U, D or refund) and when it settled.
CREATE TABLE IF NOT EXISTS rt_windows (
    id TEXT PRIMARY KEY,
    lane TEXT NOT NULL,
    asset TEXT NOT NULL,
    start INTEGER NOT NULL,
    expiry INTEGER NOT NULL,
    opening TEXT,
    reference TEXT,
    closing TEXT,
    outcome TEXT,
    settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS rt_windows_unsettled ON rt_windows (outcome, start);
CREATE INDEX IF NOT EXISTS rt_windows_settled ON rt_windows (settled_at);
CREATE INDEX IF NOT EXISTS rt_windows_expiry ON rt_windows (expiry);

-- Chip deposits (plan §00): every received output whose memo names a deposit id. A deposit's
-- mintable amount is its confirmed outputs less what it already minted.
CREATE TABLE IF NOT EXISTS deposit_outputs (
    txid TEXT NOT NULL,
    pool INTEGER NOT NULL,
    output_index INTEGER NOT NULL,
    deposit_id TEXT NOT NULL,
    amount_zat INTEGER NOT NULL,
    height INTEGER NOT NULL,
    PRIMARY KEY (txid, pool, output_index)
);
CREATE INDEX IF NOT EXISTS deposit_outputs_id ON deposit_outputs (deposit_id);
CREATE TABLE IF NOT EXISTS deposit_issued (
    deposit_id TEXT PRIMARY KEY,
    issued_zat INTEGER NOT NULL
);

-- Spent chips by Y = hash_to_curve(secret) (NUT-07). A chip is spent once, ever.
CREATE TABLE IF NOT EXISTS spent (
    y TEXT PRIMARY KEY,
    spent_at INTEGER NOT NULL
);

-- Withdrawals: spent chips owed to a shielded address, paid as canonical notes (payouts.rs).
CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_zat INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- NUT-19 cached responses: a successful mint, swap or withdrawal keyed by a hash of the exact
-- request, written in the same transaction as its spend, so resending the same request after a
-- lost answer returns the same signatures instead of losing the chips.
CREATE TABLE IF NOT EXISTS responses (
    key TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Hourly prints files (write-once, pushed like bundles).
CREATE TABLE IF NOT EXISTS prints_files (
    hour INTEGER PRIMARY KEY,
    file TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
";

/// Cached responses are kept this long (a client resends within seconds or minutes).
const RESPONSES_KEEP_SECS: i64 = 2 * 86_400;
/// Minute closes are kept this long (the hourly prints files keep them for good).
const MINUTES_KEEP_SECS: i64 = 48 * 3_600;
/// Window rows are kept this long (positions refer to them until they settle and redeem).
const WINDOWS_KEEP_SECS: i64 = 7 * 86_400;

#[derive(Clone, Debug)]
pub struct WindowRow {
    pub id: String,
    pub asset: String,
    pub start: i64,
    pub expiry: i64,
    pub opening: Option<String>,
    /// Every venue's opening print is in (or the grace passed): `opening` won't change again.
    pub opening_final: bool,
    /// The venues the reference was taken from (JSON array): the ones committed when it was set.
    pub reference_venues: Option<String>,
    pub reference: Option<String>,
    pub closing: Option<String>,
    pub outcome: Option<String>,
    pub settled_at: Option<i64>,
}

const WINDOW_COLUMNS: &str = "id, asset, start, expiry, opening, reference, closing, outcome, settled_at, opening_final, \
     reference_venues";

fn window_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<WindowRow> {
    Ok(WindowRow {
        id: r.get(0)?,
        asset: r.get(1)?,
        start: r.get(2)?,
        expiry: r.get(3)?,
        opening: r.get(4)?,
        reference: r.get(5)?,
        closing: r.get(6)?,
        outcome: r.get(7)?,
        settled_at: r.get(8)?,
        opening_final: r.get::<_, i64>(9)? != 0,
        reference_venues: r.get(10)?,
    })
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    // T3: the reference is recorded from the first two venues, the opening prints completed later.
    let has_final: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('rt_windows') WHERE name = 'opening_final'")?
        .exists([])?;
    if !has_final {
        conn.execute_batch(
            "ALTER TABLE rt_windows ADD COLUMN opening_final INTEGER NOT NULL DEFAULT 0;
             UPDATE rt_windows SET opening_final = 1 WHERE opening IS NOT NULL;",
        )?;
    }
    let has_venues: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('rt_windows') WHERE name = 'reference_venues'")?
        .exists([])?;
    if !has_venues {
        conn.execute_batch("ALTER TABLE rt_windows ADD COLUMN reference_venues TEXT;")?;
    }
    Ok(())
}

/// Stores every committed minute (a later read never changes a committed one).
pub fn put_minutes(conn: &mut Connection, reads: &[VenueMinutes]) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut stored = 0;
    {
        let mut insert = tx.prepare(
            "INSERT OR IGNORE INTO minute_closes (asset, venue, start, close) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for read in reads {
            for (start, candle) in &read.minutes {
                let close = match candle {
                    Candle::Close(c) => Some(c.as_str()),
                    Candle::NoTrades => None,
                    Candle::NotYet => continue,
                };
                stored += insert.execute(params![read.asset, read.venue.key(), start, close])?;
            }
        }
    }
    tx.commit()?;
    Ok(stored)
}

/// `None`: the venue hasn't committed that minute yet; `Some(None)`: it had no trades.
pub fn minute(
    conn: &Connection,
    asset: &str,
    venue: &str,
    start: i64,
) -> Result<Option<Option<String>>> {
    Ok(conn
        .query_row(
            "SELECT close FROM minute_closes WHERE asset = ?1 AND venue = ?2 AND start = ?3",
            params![asset, venue, start],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()?)
}

/// Every committed minute of `asset` on `venue` in `[from, to)`, oldest first.
pub fn minutes_between(
    conn: &Connection,
    asset: &str,
    venue: &str,
    from: i64,
    to: i64,
) -> Result<Vec<(i64, Option<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT start, close FROM minute_closes
         WHERE asset = ?1 AND venue = ?2 AND start >= ?3 AND start < ?4 ORDER BY start",
    )?;
    let rows = stmt
        .query_map(params![asset, venue, from, to], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn ensure_window(conn: &Connection, asset: &str, window: &LaneWindow) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO rt_windows (id, lane, asset, start, expiry) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![window.id, window.lane, asset, window.start, window.expiry],
    )?;
    Ok(())
}

pub fn window(conn: &Connection, id: &str) -> Result<Option<WindowRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {WINDOW_COLUMNS} FROM rt_windows WHERE id = ?1"),
            [id],
            window_row,
        )
        .optional()?)
}

/// Windows that have started and not settled.
pub fn unsettled(conn: &Connection, now: i64) -> Result<Vec<WindowRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {WINDOW_COLUMNS} FROM rt_windows WHERE outcome IS NULL AND start <= ?1 ORDER BY start"
    ))?;
    let rows = stmt
        .query_map([now], window_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Windows settled at or after `since`, newest first.
pub fn settled_since(conn: &Connection, since: i64) -> Result<Vec<WindowRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {WINDOW_COLUMNS} FROM rt_windows WHERE settled_at >= ?1 ORDER BY settled_at DESC, id"
    ))?;
    let rows = stmt
        .query_map([since], window_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Windows that expire in `[from, to)`, by expiry then id.
pub fn expiring_between(conn: &Connection, from: i64, to: i64) -> Result<Vec<WindowRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {WINDOW_COLUMNS} FROM rt_windows WHERE expiry >= ?1 AND expiry < ?2 ORDER BY expiry, id"
    ))?;
    let rows = stmt
        .query_map([from, to], window_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Records a Window's opening prints so far. The reference (and the venues it was taken from) is
/// written once, the first time it is known, and never moves; the prints keep filling in until
/// `last`.
pub fn set_opening(
    conn: &Connection,
    id: &str,
    opening: &Prints,
    reference: Option<(&str, &[&str])>,
    last: bool,
) -> Result<()> {
    let (reference, venues) = match reference {
        Some((r, v)) => (Some(r), Some(serde_json::to_string(v)?)),
        None => (None, None),
    };
    conn.execute(
        "UPDATE rt_windows SET opening = ?2, reference = COALESCE(reference, ?3),
             reference_venues = COALESCE(reference_venues, ?5), opening_final = ?4
         WHERE id = ?1 AND opening_final = 0",
        params![id, prints_json(opening), reference, i64::from(last), venues],
    )?;
    Ok(())
}

pub fn settle(
    conn: &Connection,
    id: &str,
    closing: &Prints,
    outcome: &str,
    now: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE rt_windows SET closing = ?2, outcome = ?3, settled_at = ?4 WHERE id = ?1 AND outcome IS NULL",
        params![id, prints_json(closing), outcome, now],
    )?;
    Ok(())
}

pub fn prints_file(conn: &Connection, hour: i64) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT file FROM prints_files WHERE hour = ?1",
            [hour],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn put_prints_file(conn: &Connection, hour: i64, file: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO prints_files (hour, file, created_at) VALUES (?1, ?2, ?3)",
        params![hour, file, now],
    )?;
    Ok(())
}

/// Prints files for hours at or after `since`, oldest first.
pub fn prints_files_since(conn: &Connection, since: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT file FROM prints_files WHERE hour >= ?1 ORDER BY hour")?;
    let rows = stmt
        .query_map([since], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn prune(conn: &Connection, now: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM minute_closes WHERE start < ?1",
        [now - MINUTES_KEEP_SECS],
    )?;
    conn.execute(
        "DELETE FROM rt_windows WHERE expiry < ?1 AND outcome IS NOT NULL",
        [now - WINDOWS_KEEP_SECS],
    )?;
    conn.execute(
        "DELETE FROM responses WHERE created_at < ?1",
        [now - RESPONSES_KEEP_SECS],
    )?;
    Ok(())
}

/// `{ venue: close | null }` in vote order (canonical JSON sorts the keys when signed).
pub fn prints_json(prints: &Prints) -> String {
    Value::Object(prints_map(prints)).to_string()
}

pub fn prints_map(prints: &Prints) -> Map<String, Value> {
    prints
        .iter()
        .map(|(venue, close)| {
            (
                (*venue).to_string(),
                close.clone().map_or(Value::Null, Value::String),
            )
        })
        .collect()
}

/// One received deposit output, as `deposits.rs` reads it from the wallet.
pub struct DepositOutput {
    pub txid: String,
    pub pool: u8,
    pub output_index: u32,
    pub deposit_id: String,
    pub amount_zat: u64,
    pub height: u32,
}

pub fn put_deposit_outputs(conn: &mut Connection, outputs: &[DepositOutput]) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut stored = 0;
    {
        let mut insert = tx.prepare(
            "INSERT OR IGNORE INTO deposit_outputs (txid, pool, output_index, deposit_id, amount_zat, height)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for o in outputs {
            stored += insert.execute(params![
                o.txid,
                o.pool,
                o.output_index,
                o.deposit_id,
                o.amount_zat,
                o.height
            ])?;
        }
    }
    tx.commit()?;
    Ok(stored)
}

/// A deposit's state: everything received (confirmed or not), what is confirmed at `tip` with
/// `confirmations`, and what it has already minted.
pub struct DepositState {
    pub received_zat: u64,
    pub confirmed_zat: u64,
    pub issued_zat: u64,
    pub first_height: Option<u32>,
}

pub fn deposit_state(
    conn: &Connection,
    deposit_id: &str,
    tip: u32,
    confirmations: u32,
) -> Result<DepositState> {
    let (received, confirmed, first): (i64, i64, Option<u32>) = conn.query_row(
        "SELECT COALESCE(SUM(amount_zat), 0),
                COALESCE(SUM(CASE WHEN height + ?2 <= ?3 + 1 THEN amount_zat ELSE 0 END), 0),
                MIN(height)
         FROM deposit_outputs WHERE deposit_id = ?1",
        params![deposit_id, confirmations, tip],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let issued: i64 = conn
        .query_row(
            "SELECT issued_zat FROM deposit_issued WHERE deposit_id = ?1",
            [deposit_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0);
    Ok(DepositState {
        received_zat: u64::try_from(received)?,
        confirmed_zat: u64::try_from(confirmed)?,
        issued_zat: u64::try_from(issued)?,
        first_height: first,
    })
}

/// Records that a deposit minted `zat` more, inside the caller's transaction.
pub fn add_issued(tx: &rusqlite::Transaction<'_>, deposit_id: &str, zat: u64) -> Result<()> {
    tx.execute(
        "INSERT INTO deposit_issued (deposit_id, issued_zat) VALUES (?1, ?2)
         ON CONFLICT (deposit_id) DO UPDATE SET issued_zat = issued_zat + excluded.issued_zat",
        params![deposit_id, zat],
    )?;
    Ok(())
}

/// Marks every chip spent, inside the caller's transaction; fails (and the caller rolls back) if
/// any was spent before.
pub fn spend(tx: &rusqlite::Transaction<'_>, ys: &[String], now: i64) -> Result<()> {
    for y in ys {
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO spent (y, spent_at) VALUES (?1, ?2)",
            params![y, now],
        )?;
        anyhow::ensure!(inserted == 1, "a chip was already spent");
    }
    Ok(())
}

/// `true` for each Y already spent (NUT-07 state check).
pub fn spent_states(conn: &Connection, ys: &[String]) -> Result<Vec<bool>> {
    ys.iter()
        .map(|y| {
            Ok(conn
                .query_row("SELECT 1 FROM spent WHERE y = ?1", [y], |_| Ok(()))
                .optional()?
                .is_some())
        })
        .collect()
}

pub fn new_withdrawal(tx: &rusqlite::Transaction<'_>, zat: u64, now: i64) -> Result<u32> {
    tx.execute(
        "INSERT INTO withdrawals (amount_zat, created_at) VALUES (?1, ?2)",
        params![zat, now],
    )?;
    Ok(u32::try_from(tx.last_insert_rowid())?)
}

pub fn cached_response(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT body FROM responses WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

pub fn cache_response(
    tx: &rusqlite::Transaction<'_>,
    key: &str,
    body: &str,
    now: i64,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO responses (key, body, created_at) VALUES (?1, ?2, ?3)",
        params![key, body, now],
    )?;
    Ok(())
}
