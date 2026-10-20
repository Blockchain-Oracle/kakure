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
    // The stake as opened, which a Reduce never changes: the published volume sums it, so a partial close can't be
    // read off a Window's volume (privacy re-audit V5). Older rows take their current stake.
    let has_opened: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('positions') WHERE name = 'opened_stake_zat'")?
        .exists([])?;
    if !has_opened {
        conn.execute_batch(
            "ALTER TABLE positions ADD COLUMN opened_stake_zat INTEGER;
             UPDATE positions SET opened_stake_zat = stake_zat WHERE opened_stake_zat IS NULL;",
        )?;
    }
    // When the client first took the proceeds an exit or the mint signed for it: until then the row is kept, however
    // long the owner stays away (Codex review K3).
    let has_collected: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('positions') WHERE name = 'collected_at'")?
        .exists([])?;
    if !has_collected {
        conn.execute_batch("ALTER TABLE positions ADD COLUMN collected_at INTEGER;")?;
    }
    Ok(())
}

/// Notes that the owner has taken the proceeds signed for it (`/v1/position`); a lost answer can be asked again.
pub fn mark_collected(conn: &Connection, id: &str, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE positions SET collected_at = COALESCE(collected_at, ?2)
         WHERE id = ?1 AND exit_signatures IS NOT NULL AND state IN ('closed', 'redeemed')",
        params![id, now],
    )?;
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
             opened_at, state, band, opened_stake_zat)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11, ?6)",
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
/// The open payout on one side of a Window, rounded UP to a multiple of `quantum`: what the side cap
/// is checked against, so a refused probe can't measure the side's exact open book, only which
/// quantum it has reached (privacy re-audit V2).
pub fn side_payout_bucket(
    conn: &Connection,
    window: &str,
    side: &str,
    quantum: u64,
) -> Result<u64> {
    Ok(side_payout(conn, window, side)?.div_ceil(quantum) * quantum)
}

pub fn side_payout(conn: &Connection, window: &str, side: &str) -> Result<u64> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(payout_zat), 0) FROM positions
         WHERE window = ?1 AND side = ?2 AND state IN ('open', 'armed')",
        params![window, side],
        |r| r.get(0),
    )?)
}

/// Marks a position paid (closed or redeemed) with what it paid; the ledger counts it out.
/// The terms a payment was computed from: it lands only while the position still has them, so two
/// requests (two partial closes, or a close and a firing exit) can never both be paid from one
/// snapshot (Codex review K1).
#[derive(Clone, Copy, Debug)]
pub struct Terms {
    pub stake_zat: u64,
    pub payout_zat: u64,
}

impl Position {
    pub fn terms(&self) -> Terms {
        Terms {
            stake_zat: self.stake_zat,
            payout_zat: self.payout_zat,
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn finish(
    tx: &Transaction<'_>,
    id: &str,
    terms: Terms,
    state: &str,
    how: &str,
    paid_zat: u64,
    signatures: Option<&str>,
    now: i64,
) -> Result<()> {
    let changed = tx.execute(
        "UPDATE positions SET state = ?2, how = ?3, paid_zat = ?4, exit_signatures = ?5,
             finished_at = ?6
         WHERE id = ?1 AND state IN ('open', 'armed') AND stake_zat = ?7 AND payout_zat = ?8",
        params![
            id,
            state,
            how,
            paid_zat,
            signatures,
            now,
            terms.stake_zat,
            terms.payout_zat
        ],
    )?;
    anyhow::ensure!(changed == 1, "the position was already paid or changed");
    add_to_ledger(tx, "paid", paid_zat)?;
    Ok(())
}

/// A partial close: the position keeps running on what's left, and the ledger counts the share
/// paid out.
pub fn reduce(
    tx: &Transaction<'_>,
    id: &str,
    terms: Terms,
    stake_left: u64,
    payout_left: u64,
    paid_zat: u64,
) -> Result<()> {
    let changed = tx.execute(
        "UPDATE positions SET stake_zat = ?2, payout_zat = ?3
         WHERE id = ?1 AND state IN ('open', 'armed') AND stake_zat = ?4 AND payout_zat = ?5",
        params![
            id,
            stake_left,
            payout_left,
            terms.stake_zat,
            terms.payout_zat
        ],
    )?;
    anyhow::ensure!(changed == 1, "the position was already paid or changed");
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

/// The house's book at one moment, in zatoshi.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Book {
    /// Chips outstanding: minted from deposits, plus paid out of positions, less staked, less withdrawn.
    pub chips_outstanding: u64,
    /// The most open positions could cost: each unsettled Window's larger side, every open parlay
    /// and band, plus what settled ones still owe.
    pub open_max_payout: u64,
}

impl Book {
    /// The published statement (plan §00 residual risks: "signed liability statements"): each figure
    /// rounded UP to a multiple of `quantum`, so it stays a true upper bound while one trade, deposit
    /// or withdrawal can't be read off the difference between two statements (privacy re-audit V1).
    pub fn statement(&self, quantum: u64, as_of: &str) -> Value {
        let up = |zat: u64| zat.div_ceil(quantum) * quantum;
        json!({
            "chipsOutstandingZat": up(self.chips_outstanding).to_string(),
            "openMaxPayoutZat": up(self.open_max_payout).to_string(),
            "quantumZat": quantum.to_string(),
            "asOf": as_of,
        })
    }
}

/// The house's book, read from the ledger and the open positions.
pub fn book(conn: &Connection) -> Result<Book> {
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
    Ok(Book {
        chips_outstanding: outstanding,
        open_max_payout: unsettled + owed + parlays + bands,
    })
}

/// A Window's published activity: trade count and volume over the first ⌊n/3⌋·3 singles opened on
/// it, so no single trade's size can be read off a change; nothing until there are 3.
pub fn window_volume(
    conn: &Connection,
    window: &str,
    group: usize,
) -> Result<Option<(usize, u64)>> {
    let mut stmt = conn.prepare(
        "SELECT opened_stake_zat FROM positions WHERE window = ?1 AND kind = 'single'
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
    // A position paid in its own answer leaves after two days; one whose proceeds wait to be collected stays until two
    // days after it was collected, never before (Codex review K3).
    conn.execute(
        "DELETE FROM positions WHERE state IN ('closed', 'redeemed') AND finished_at < ?1
           AND (exit_signatures IS NULL OR (collected_at IS NOT NULL AND collected_at < ?1))",
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
        super::book(conn).unwrap().open_max_payout.to_string()
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

    fn single(conn: &Connection, id: &str, window: &str, stake: u64) {
        let tx = conn.unchecked_transaction().unwrap();
        let position = Position {
            id: id.into(),
            kind: Kind::Single,
            window: Some(window.into()),
            side: Some("U".into()),
            legs: vec![],
            stake_zat: stake,
            price: 5_000,
            payout_zat: stake * 2,
            lock: "00".into(),
            opened_at: 0,
            state: "open".into(),
            paid_zat: None,
            how: None,
            exit: None,
            exit_outputs: None,
            exit_signatures: None,
            band: None,
        };
        insert(&tx, &position).unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn a_reduce_never_shows_in_the_volume() {
        let conn = book();
        window(&conn, "btc-5m-3", None, None);
        for (id, stake) in [("p", 1_000_000), ("q", 2_000_000), ("r", 3_000_000)] {
            single(&conn, id, "btc-5m-3", stake);
        }
        assert_eq!(
            window_volume(&conn, "btc-5m-3", 3).unwrap(),
            Some((3, 6_000_000))
        );
        let tx = conn.unchecked_transaction().unwrap();
        let terms = Terms {
            stake_zat: 2_000_000,
            payout_zat: 4_000_000,
        };
        reduce(&tx, "q", terms, 1_000_000, 2_000_000, 1_900_000).unwrap();
        tx.commit().unwrap();
        assert_eq!(
            window_volume(&conn, "btc-5m-3", 3).unwrap(),
            Some((3, 6_000_000))
        );
    }

    #[test]
    fn a_stale_snapshot_is_never_paid_twice() {
        let conn = book();
        window(&conn, "btc-5m-4", None, None);
        single(&conn, "s", "btc-5m-4", 2_000_000);
        let snapshot = Terms {
            stake_zat: 2_000_000,
            payout_zat: 4_000_000,
        };
        // Two partial closes computed from the same snapshot: the first lands, the second is refused.
        let tx = conn.unchecked_transaction().unwrap();
        reduce(&tx, "s", snapshot, 1_000_000, 2_000_000, 1_900_000).unwrap();
        tx.commit().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        assert!(reduce(&tx, "s", snapshot, 1_000_000, 2_000_000, 1_900_000).is_err());
        // An exit firing on the old snapshot is refused too; on the current terms it pays.
        assert!(finish(&tx, "s", snapshot, "closed", "trail", 3_800_000, None, 1).is_err());
        let now = Terms {
            stake_zat: 1_000_000,
            payout_zat: 2_000_000,
        };
        finish(&tx, "s", now, "closed", "trail", 1_900_000, None, 1).unwrap();
    }

    #[test]
    fn proceeds_and_windows_outlive_the_prune_until_used() {
        let conn = book();
        // The pool-era store owns `payouts`; the prune reads its withdrawal rows.
        conn.execute_batch(
            "CREATE TABLE payouts (kind TEXT, status TEXT, built_at INTEGER, receipt_txid TEXT, recipient TEXT)",
        )
        .unwrap();
        let old = 1_000;
        let later = old + 30 * 86_400;
        conn.execute(
            "INSERT INTO rt_windows (id, lane, asset, start, expiry, outcome) VALUES ('btc-5m-9', 'btc-5m', 'BTC', 0, ?1, 'U')",
            [old],
        )
        .unwrap();
        single(&conn, "open", "btc-5m-9", 1_000_000);
        single(&conn, "fired", "btc-5m-9", 1_000_000);
        let tx = conn.unchecked_transaction().unwrap();
        let terms = Terms {
            stake_zat: 1_000_000,
            payout_zat: 2_000_000,
        };
        finish(
            &tx,
            "fired",
            terms,
            "closed",
            "trail",
            1_500_000,
            Some("[]"),
            old,
        )
        .unwrap();
        tx.commit().unwrap();
        prune(&conn, later).unwrap();
        rt_store::prune(&conn, later).unwrap();
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        // Uncollected proceeds stay; the Window an open position rides on stays.
        assert_eq!(
            count("SELECT COUNT(*) FROM positions WHERE id = 'fired'"),
            1
        );
        assert_eq!(
            count("SELECT COUNT(*) FROM rt_windows WHERE id = 'btc-5m-9'"),
            1
        );
        // Collected, and two days on, the row goes; redeemed, the Window goes.
        mark_collected(&conn, "fired", old).unwrap();
        conn.execute(
            "UPDATE positions SET state = 'redeemed', finished_at = ?1 WHERE id = 'open'",
            [old],
        )
        .unwrap();
        prune(&conn, later).unwrap();
        rt_store::prune(&conn, later).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM positions"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM rt_windows"), 0);
    }

    #[test]
    fn the_statement_rounds_up_to_its_quantum() {
        let book = Book {
            chips_outstanding: 1,
            open_max_payout: 2_000_000_000,
        };
        let statement = book.statement(1_000_000_000, "2026-10-20T13:00:07Z");
        assert_eq!(statement["chipsOutstandingZat"], "1000000000");
        assert_eq!(statement["openMaxPayoutZat"], "2000000000");
        assert_eq!(statement["quantumZat"], "1000000000");
        let empty = Book {
            chips_outstanding: 0,
            open_max_payout: 0,
        };
        assert_eq!(
            empty.statement(1_000_000_000, "x")["chipsOutstandingZat"],
            "0"
        );
    }
}
