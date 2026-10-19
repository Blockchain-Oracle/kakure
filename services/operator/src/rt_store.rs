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

-- Hourly prints files (write-once, pushed like bundles).
CREATE TABLE IF NOT EXISTS prints_files (
    hour INTEGER PRIMARY KEY,
    file TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
";

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
    pub reference: Option<String>,
    pub closing: Option<String>,
    pub outcome: Option<String>,
    pub settled_at: Option<i64>,
}

const WINDOW_COLUMNS: &str =
    "id, asset, start, expiry, opening, reference, closing, outcome, settled_at";

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
    })
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
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

pub fn set_opening(
    conn: &Connection,
    id: &str,
    opening: &Prints,
    reference: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE rt_windows SET opening = ?2, reference = ?3 WHERE id = ?1 AND opening IS NULL",
        params![id, prints_json(opening), reference],
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
