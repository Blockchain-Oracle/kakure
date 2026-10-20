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

use crate::{lanes, rt_store, settle};

const SCHEMA: &str = "
-- What trades bought. `price` is the single's or band's ask in 1/10^4, or the parlay price in 1/10^8.
-- A band (Range, Moonshot) keeps its edges in `band` (JSON lo and hi, decimal strings or null) and
-- its side (in or out) in `side`.
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
    exit_signatures TEXT,
    band TEXT
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
    // Databases from before bands (T5a) gain the column.
    let has_band: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('positions') WHERE name = 'band'")?
        .exists([])?;
    if !has_band {
        conn.execute_batch("ALTER TABLE positions ADD COLUMN band TEXT")?;
    }
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
    pub band: Option<Band>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Single,
    Parlay,
    Band,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Single => "single",
            Kind::Parlay => "parlay",
            Kind::Band => "band",
        }
    }
}

/// A band's edges: decimal strings as the client sent them; a missing edge is unbounded.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Band {
    pub lo: Option<String>,
    pub hi: Option<String>,
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
     state, paid_zat, how, exit, exit_outputs, exit_signatures, band";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Position> {
    let kind: String = r.get(1)?;
    let legs: Option<String> = r.get(4)?;
    let exit: Option<String> = r.get(13)?;
    let band: Option<String> = r.get(16)?;
    Ok(Position {
        id: r.get(0)?,
        kind: match kind.as_str() {
            "parlay" => Kind::Parlay,
            "band" => Kind::Band,
            _ => Kind::Single,
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
        band: band.and_then(|b| serde_json::from_str(&b).ok()),
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
            Kind::Band => {
                let band = self.band.clone().unwrap_or_default();
                json!({
                    "id": self.id,
                    "kind": "band",
                    "window": self.window,
                    "lo": band.lo,
                    "hi": band.hi,
                    "side": self.side,
                    "stakeZat": self.stake_zat.to_string(),
                    "askE4": self.price,
                    "payoutZat": self.payout_zat.to_string(),
                    "openedAt": self.opened_at,
                    "lock": self.lock,
                })
            }
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
             opened_at, state, band)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11)",
        params![
            p.id,
            p.kind.name(),
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
            p.band.as_ref().map(serde_json::to_string).transpose()?,
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

/// A partial close: the position keeps running on what's left, and the ledger counts the share
/// paid out.
pub fn reduce(
    tx: &Transaction<'_>,
    id: &str,
    stake_left: u64,
    payout_left: u64,
    paid_zat: u64,
) -> Result<()> {
    let changed = tx.execute(
        "UPDATE positions SET stake_zat = ?2, payout_zat = ?3
         WHERE id = ?1 AND state IN ('open', 'armed')",
        params![id, stake_left, payout_left],
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

/// What a band is worth once its Window has settled: its payout when two of three closing prints
/// fall on its side of the edges, its stake back on a refund, nothing otherwise; `None` while the
/// Window is open. The one rule redemption and the published book both use.
pub fn band_value(p: &Position, window: &rt_store::WindowRow) -> Option<u64> {
    window.outcome.as_ref()?;
    let (side, band) = (p.side.as_deref()?, p.band.as_ref()?);
    let asset = lanes::asset(&window.asset)?;
    let closing = window
        .closing
        .as_deref()
        .map(settle::prints_from_json)
        .unwrap_or_default();
    let outcome = settle::band_outcome_of(
        &settle::venue_keys(asset),
        &closing,
        band.lo.as_deref(),
        band.hi.as_deref(),
    );
    Some(if outcome == side {
        p.payout_zat
    } else if outcome == "refund" {
        p.stake_zat
    } else {
        0
    })
}

/// The bands the house still owes on: every open one at its full payout while its Window trades
/// (one closing price can land inside many bands, so none offsets another), and what each settled
/// one is worth until it is redeemed.
fn band_book(conn: &Connection) -> Result<u64> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM positions WHERE kind = 'band' AND state IN ('open', 'armed')"
    ))?;
    let bands = stmt
        .query_map([], row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut owed = 0u64;
    for band in &bands {
        let Some(window) = band.window.as_deref() else {
            continue;
        };
        owed += match rt_store::window(conn, window)? {
            Some(w) if w.outcome.is_some() => band_value(band, &w).unwrap_or(0),
            _ => band.payout_zat,
        };
    }
    Ok(owed)
}

/// The house's published book: chips outstanding (minted from deposits, plus paid out of
/// positions, less staked, less withdrawn) and the most open positions could cost it (each
/// unsettled Window's larger side, every open parlay and band, plus what settled ones still owe).
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
    let bands = band_book(conn)?;
    Ok(json!({
        "chipsOutstandingZat": outstanding.to_string(),
        "openMaxPayoutZat": (unsettled + owed + parlays + bands).to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn book() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        rt_store::migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn window(conn: &Connection, id: &str, closing: Option<&str>, outcome: Option<&str>) {
        conn.execute(
            "INSERT INTO rt_windows (id, lane, asset, start, expiry, closing, outcome)
             VALUES (?1, 'btc-5m', 'BTC', 0, 300, ?2, ?3)",
            params![id, closing, outcome],
        )
        .unwrap();
    }

    fn band(
        conn: &Connection,
        id: &str,
        window: &str,
        (lo, hi): (&str, &str),
        stake: u64,
        payout: u64,
    ) {
        let tx = conn.unchecked_transaction().unwrap();
        let position = Position {
            id: id.into(),
            kind: Kind::Band,
            window: Some(window.into()),
            side: Some("in".into()),
            legs: vec![],
            stake_zat: stake,
            price: 5_000,
            payout_zat: payout,
            lock: "00".into(),
            opened_at: 0,
            state: "open".into(),
            paid_zat: None,
            how: None,
            exit: None,
            exit_outputs: None,
            exit_signatures: None,
            band: Some(Band {
                lo: Some(lo.into()),
                hi: Some(hi.into()),
            }),
        };
        insert(&tx, &position).unwrap();
        tx.commit().unwrap();
    }

    fn open_max(conn: &Connection) -> String {
        liabilities(conn).unwrap()["openMaxPayoutZat"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    #[test]
    fn the_book_counts_bands() {
        let conn = book();
        // Two overlapping bands on a trading Window: one closing price can pay both, so both count in full.
        window(&conn, "btc-5m-1", None, None);
        band(&conn, "a", "btc-5m-1", ("100", "200"), 1_000_000, 2_000_000);
        band(&conn, "b", "btc-5m-1", ("150", "250"), 1_000_000, 3_000_000);
        assert_eq!(open_max(&conn), "5000000");

        // A settled Window: two of three closes at 120 put band c inside (owed) and band d outside (nothing).
        let closing = r#"{"coinbase":"120","kraken":"120","bitstamp":"300"}"#;
        window(&conn, "btc-5m-2", Some(closing), Some("U"));
        band(&conn, "c", "btc-5m-2", ("100", "130"), 1_000_000, 4_000_000);
        band(&conn, "d", "btc-5m-2", ("200", "260"), 1_000_000, 6_000_000);
        assert_eq!(open_max(&conn), "9000000");
    }
}
