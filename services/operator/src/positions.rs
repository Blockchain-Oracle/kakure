//! Positions and the house's book (plan §00 T3 contract), in `engine.sqlite`.
//!
//! A position is what a trade buys: a stake on one Window side (or a 2–3 leg parlay) with a payout
//! fixed at the ask, controlled by whoever knows the secret behind its `lock` (SHA-256). The
//! operator keeps only the lock, never the secret. Positions aren't blinded: the operator links a
//! position's open to its close or redeem (one anonymous trade), never to a deposit, a withdrawal
//! or another position.
//!
//! Running totals (staked, paid out, withdrawn) live in `house_ledger`, so the published
//! liabilities don't need old rows: a position leaves the table two days after it's paid.

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Value, json};

const SCHEMA: &str = "
-- What trades bought. `price` is the single ask in 1/10^4 or the parlay price in 1/10^8.
-- state: open | armed (an exit is waiting) | closed | redeemed.
-- how: close | trail | stop | takeProfit | redeem | settled (redeemed by the mint for an armed one).
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    window TEXT,
    side TEXT,
    legs TEXT,
    stake_zat INTEGER NOT NULL,
    price INTEGER NOT NULL,
    payout_zat INTEGER NOT NULL,
    lock TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    state TEXT NOT NULL,
    paid_zat INTEGER,
    finished_at INTEGER,
    how TEXT,
    exit TEXT,
    exit_outputs TEXT,
    exit_signatures TEXT
);
CREATE INDEX IF NOT EXISTS positions_window ON positions (window, side, state);
CREATE INDEX IF NOT EXISTS positions_state ON positions (state);

-- Running totals in zatoshi: staked (chips into positions), paid (chips out of them), withdrawn.
CREATE TABLE IF NOT EXISTS house_ledger (
    key TEXT PRIMARY KEY,
    zat INTEGER NOT NULL
);
";

/// Finished positions leave the table this long after they're paid (the NUT-19 answer cache is
/// kept as long, so a lost answer can still be fetched again).
const FINISHED_KEEP_SECS: i64 = 2 * 86_400;

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct Position {
    pub id: String,
    pub kind: Kind,
    pub window: Option<String>,
    pub side: Option<String>,
    pub legs: Vec<Leg>,
    pub stake_zat: u64,
    pub price: u64,
    pub payout_zat: u64,
    pub lock: String,
    pub opened_at: i64,
    pub state: String,
    pub paid_zat: Option<u64>,
    pub how: Option<String>,
    pub exit: Option<Value>,
    pub exit_outputs: Option<String>,
    pub exit_signatures: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Single,
    Parlay,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Leg {
    pub window: String,
    pub side: String,
    pub ask_e4: u64,
    pub expiry: i64,
}

const COLUMNS: &str = "id, kind, window, side, legs, stake_zat, price, payout_zat, lock, opened_at, \
     state, paid_zat, how, exit, exit_outputs, exit_signatures";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Position> {
    let kind: String = r.get(1)?;
    let legs: Option<String> = r.get(4)?;
    let exit: Option<String> = r.get(13)?;
    Ok(Position {
        id: r.get(0)?,
        kind: if kind == "parlay" {
            Kind::Parlay
        } else {
            Kind::Single
        },
        window: r.get(2)?,
        side: r.get(3)?,
        legs: legs
            .and_then(|l| serde_json::from_str(&l).ok())
            .unwrap_or_default(),
        stake_zat: r.get(5)?,
        price: r.get(6)?,
        payout_zat: r.get(7)?,
        lock: r.get(8)?,
        opened_at: r.get(9)?,
        state: r.get(10)?,
        paid_zat: r.get(11)?,
        how: r.get(12)?,
        exit: exit.and_then(|e| serde_json::from_str(&e).ok()),
        exit_outputs: r.get(14)?,
        exit_signatures: r.get(15)?,
    })
}

impl Position {
    /// The certificate the client keeps (signed by the operator's key on the way out).
    pub fn certificate(&self) -> Value {
        match self.kind {
            Kind::Single => json!({
                "id": self.id,
                "kind": "single",
                "window": self.window,
                "side": self.side,
                "stakeZat": self.stake_zat.to_string(),
                "askE4": self.price,
                "payoutZat": self.payout_zat.to_string(),
                "openedAt": self.opened_at,
                "lock": self.lock,
            }),
            Kind::Parlay => json!({
                "id": self.id,
                "kind": "parlay",
                "legs": self.legs,
                "stakeZat": self.stake_zat.to_string(),
                "priceE8": self.price,
                "payoutZat": self.payout_zat.to_string(),
                "openedAt": self.opened_at,
                "lock": self.lock,
            }),
        }
    }

    pub fn is_live(&self) -> bool {
        self.state == "open" || self.state == "armed"
    }
}

pub fn insert(tx: &Transaction<'_>, p: &Position) -> Result<()> {
    tx.execute(
        "INSERT INTO positions (id, kind, window, side, legs, stake_zat, price, payout_zat, lock,
             opened_at, state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open')",
        params![
            p.id,
            if p.kind == Kind::Parlay {
                "parlay"
            } else {
                "single"
            },
            p.window,
            p.side,
            if p.legs.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&p.legs)?)
            },
            p.stake_zat,
            p.price,
            p.payout_zat,
            p.lock,
            p.opened_at,
        ],
    )?;
    add_to_ledger(tx, "staked", p.stake_zat)?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Position>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM positions WHERE id = ?1"),
            [id],
            row,
        )
        .optional()?)
}

/// Positions with an exit waiting.
pub fn armed(conn: &Connection) -> Result<Vec<Position>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM positions WHERE state = 'armed'"
    ))?;
    let rows = stmt.query_map([], row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What open singles on a Window side would pay if it won.
pub fn side_payout(conn: &Connection, window: &str, side: &str) -> Result<u64> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(payout_zat), 0) FROM positions
         WHERE window = ?1 AND side = ?2 AND state IN ('open', 'armed')",
        params![window, side],
        |r| r.get(0),
    )?)
}

/// Marks a position paid (closed or redeemed) with what it paid; the ledger counts it out.
pub fn finish(
    tx: &Transaction<'_>,
    id: &str,
    state: &str,
    how: &str,
    paid_zat: u64,
    signatures: Option<&str>,
    now: i64,
) -> Result<()> {
    let changed = tx.execute(
        "UPDATE positions SET state = ?2, how = ?3, paid_zat = ?4, exit_signatures = ?5,
             finished_at = ?6
         WHERE id = ?1 AND state IN ('open', 'armed')",
        params![id, state, how, paid_zat, signatures, now],
    )?;
    anyhow::ensure!(changed == 1, "the position was already paid");
    add_to_ledger(tx, "paid", paid_zat)?;
    Ok(())
}

pub fn arm(tx: &Transaction<'_>, id: &str, exit: &Value, outputs: &str) -> Result<()> {
    let changed = tx.execute(
        "UPDATE positions SET state = 'armed', exit = ?2, exit_outputs = ?3
         WHERE id = ?1 AND state IN ('open', 'armed')",
        params![id, exit.to_string(), outputs],
    )?;
    anyhow::ensure!(changed == 1, "the position was already paid");
    Ok(())
}

pub fn disarm(tx: &Transaction<'_>, id: &str) -> Result<()> {
    tx.execute(
        "UPDATE positions SET state = 'open', exit = NULL, exit_outputs = NULL
         WHERE id = ?1 AND state = 'armed'",
        [id],
    )?;
    Ok(())
}

/// Keeps a trail's best price (only ever in the position's favour).
pub fn set_exit(conn: &Connection, id: &str, exit: &Value) -> Result<()> {
    conn.execute(
        "UPDATE positions SET exit = ?2 WHERE id = ?1 AND state = 'armed'",
        params![id, exit.to_string()],
    )?;
    Ok(())
}

pub fn add_to_ledger(tx: &Transaction<'_>, key: &str, zat: u64) -> Result<()> {
    tx.execute(
        "INSERT INTO house_ledger (key, zat) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET zat = zat + excluded.zat",
        params![key, zat],
    )?;
    Ok(())
}

fn ledger(conn: &Connection, key: &str) -> Result<u64> {
    Ok(conn
        .query_row("SELECT zat FROM house_ledger WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?
        .unwrap_or(0))
}

/// The house's published book: chips outstanding (minted from deposits, plus paid out of
/// positions, less staked, less withdrawn) and the most open positions could cost it (each
/// unsettled Window's larger side, plus every open parlay, plus what settled ones still owe).
pub fn liabilities(conn: &Connection) -> Result<Value> {
    let minted: u64 = conn.query_row(
        "SELECT COALESCE(SUM(issued_zat), 0) FROM deposit_issued",
        [],
        |r| r.get(0),
    )?;
    let outstanding = (minted + ledger(conn, "paid")?)
        .saturating_sub(ledger(conn, "staked")? + ledger(conn, "withdrawn")?);
    let unsettled: u64 = conn.query_row(
        "SELECT COALESCE(SUM(worst), 0) FROM (
             SELECT MAX(up, down) AS worst FROM (
                 SELECT p.window,
                        SUM(CASE WHEN p.side = 'U' THEN p.payout_zat ELSE 0 END) AS up,
                        SUM(CASE WHEN p.side = 'D' THEN p.payout_zat ELSE 0 END) AS down
                 FROM positions p JOIN rt_windows w ON w.id = p.window
                 WHERE p.kind = 'single' AND p.state IN ('open', 'armed') AND w.outcome IS NULL
                 GROUP BY p.window))",
        [],
        |r| r.get(0),
    )?;
    let owed: u64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN w.outcome = p.side THEN p.payout_zat
                                  WHEN w.outcome = 'refund' THEN p.stake_zat ELSE 0 END), 0)
         FROM positions p JOIN rt_windows w ON w.id = p.window
         WHERE p.kind = 'single' AND p.state IN ('open', 'armed') AND w.outcome IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    let parlays: u64 = conn.query_row(
        "SELECT COALESCE(SUM(payout_zat), 0) FROM positions
         WHERE kind = 'parlay' AND state IN ('open', 'armed')",
        [],
        |r| r.get(0),
    )?;
    Ok(json!({
        "chipsOutstandingZat": outstanding.to_string(),
        "openMaxPayoutZat": (unsettled + owed + parlays).to_string(),
    }))
}

/// A Window's published activity: trade count and volume over the first ⌊n/3⌋·3 singles opened on
/// it, so no single trade's size can be read off a change; nothing until there are 3.
pub fn window_volume(
    conn: &Connection,
    window: &str,
    group: usize,
) -> Result<Option<(usize, u64)>> {
    let mut stmt = conn.prepare(
        "SELECT stake_zat FROM positions WHERE window = ?1 AND kind = 'single'
         ORDER BY opened_at, id",
    )?;
    let stakes: Vec<u64> = stmt
        .query_map([window], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let shown = stakes.len() / group * group;
    if shown == 0 {
        return Ok(None);
    }
    Ok(Some((shown, stakes[..shown].iter().sum())))
}

/// Drops positions paid more than two days ago (the totals stay in the ledger).
pub fn prune(conn: &Connection, now: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM positions WHERE state IN ('closed', 'redeemed') AND finished_at < ?1",
        [now - FINISHED_KEEP_SECS],
    )?;
    Ok(())
}
