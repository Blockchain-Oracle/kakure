//! Settlement and the payout scheduler (plan §3, §13.1, PD16).
//!
//! - Every payout or refund is split into canonical 1/2/5 × 10^k notes; each note is its own
//!   transaction, due at a uniformly random time 2–6 h after resolution, persisted so a restart
//!   keeps the schedule, and naturally mixed across markets.
//! - Each transaction: one recipient, no memo, `OvkPolicy::Discard`, the network's most common
//!   expiry delta and marginal fee (sampled from the whole-block fetches; ZIP 203 / ZIP 317
//!   fallbacks), broadcast over Tor. The house float pays the fees.
//! - An expired transaction is rebuilt from the same inputs (re-locked and preferred).
//! - Only coarse status is published (`payoutRuns`), after the window closes; never txids.

use std::collections::{BTreeMap, HashMap};

use anyhow::{Context, Result, anyhow};
use rand::{TryRng as _, rngs::SysRng};
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::{Value, json};
use zcash_client_backend::{
    data_api::{
        InputSource as _, OutputLockStore as _, WalletRead as _, locking::LockOwner,
        wallet::input_selection::LockFilter,
    },
    wallet::OutputRef,
};
use zcash_protocol::{
    PoolType, ShieldedPool, TxId,
    consensus::{BlockHeight, NetworkUpgrade, Parameters as _},
};

use crate::{
    catalog,
    domain::{PAYOUT_WINDOW_MAX_SECS, PAYOUT_WINDOW_MIN_SECS, canonical_notes, payout_zat},
    remote::Tor,
    send::{self, Spec},
    store::{ReceiptRow, Store},
    wallet::{self, Wallet},
};

const ENV_WINDOW_MIN: &str = "KAKURE_PAYOUT_WINDOW_MIN_SECS";
const ENV_WINDOW_MAX: &str = "KAKURE_PAYOUT_WINDOW_MAX_SECS";
/// Samples older than this many blocks are ignored (and pruned).
const SAMPLE_BLOCKS: u32 = 2_000;
/// Fewer samples than this and the ZIP fallbacks apply.
const MIN_SAMPLES: usize = 20;
/// ZIP 203: default expiry delta, tripled from NU7 (ZIP 218).
const PRE_NU7_EXPIRY_DELTA: u32 = 40;
const POST_NU7_EXPIRY_DELTA: u32 = 120;
const STANDARD_MARGINAL_FEE: u64 = 5_000;
/// Note merging runs on this fixed UTC clock, never because something arrived.
pub const MERGE_INTERVAL_SECS: i64 = 6 * 60 * 60;
/// Merge once the float is spread over at least this many notes.
const MERGE_MIN_NOTES: usize = 8;
/// A merge runs only this soon after its slot boundary; a restart later in the slot skips it,
/// so merges always happen on the clock.
const MERGE_GRACE_SECS: i64 = 30 * 60;
/// Testnet-only check of the rebuild path (L08): withhold one payout's first broadcast and give
/// it a short expiry, so it expires unmined and is rebuilt from the same inputs.
const ENV_TEST_WITHHOLD: &str = "KAKURE_TEST_WITHHOLD_ONE_PAYOUT";
const TEST_WITHHOLD_EXPIRY_DELTA: u32 = 5;
const WITHHELD: &str = "withheld once (rebuild test)";
/// An expired payout's inputs stay reserved for its rebuild this many blocks.
const REBUILD_LOCK_BLOCKS: u32 = 60;
/// (id, txid, expiry, last error, lock owner, inputs)
type TrackRow = (i64, String, u32, Option<String>, Vec<u8>, Option<String>);
/// A payout that cannot be built yet (the float's change is confirming) is retried this much later.
pub const RETRY_SECS: i64 = 60;
/// Coarse status buckets: "markets resolved before HH:00".
const RUN_BUCKET_SECS: i64 = 60 * 60;
const RUN_HISTORY_SECS: i64 = 7 * catalog::DAY_SECS;

#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub min: i64,
    pub max: i64,
}

/// The payout window: 2–6 h (`PAYOUT_WINDOW_*`), overridable for a quick testnet run.
pub fn window() -> Result<Window> {
    let read = |name: &str, default: i64| -> Result<i64> {
        match std::env::var(name) {
            Ok(v) if !v.is_empty() => v.parse().with_context(|| format!("{name} must be seconds")),
            _ => Ok(default),
        }
    };
    let w = Window {
        min: read(ENV_WINDOW_MIN, PAYOUT_WINDOW_MIN_SECS)?,
        max: read(ENV_WINDOW_MAX, PAYOUT_WINDOW_MAX_SECS)?,
    };
    anyhow::ensure!(
        0 <= w.min && w.min < w.max,
        "payout window must satisfy 0 ≤ min < max"
    );
    Ok(w)
}

fn random_u64() -> Result<u64> {
    let mut bytes = [0u8; 8];
    SysRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| anyhow!("system RNG: {e}"))?;
    Ok(u64::from_le_bytes(bytes))
}

fn random_owner() -> Result<[u8; 32]> {
    let mut bytes = [0u8; 32];
    SysRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| anyhow!("system RNG: {e}"))?;
    Ok(bytes)
}

/// Amounts owed for a resolved market's tickets: `(receipt, kind, reason, zat)`.
pub fn settle<'a>(
    outcome: &str,
    reason: &str,
    tickets: &'a [ReceiptRow],
) -> Result<Vec<(&'a ReceiptRow, &'static str, String, u64)>> {
    let mut owed = vec![];
    if outcome == "refund" {
        for t in tickets {
            owed.push((
                t,
                "refund",
                reason.to_string(),
                t.size_zat.unwrap_or(t.value_zat),
            ));
        }
        return Ok(owed);
    }
    let pool = |won: bool| -> u64 {
        tickets
            .iter()
            .filter(|t| (t.side.as_deref() == Some(outcome)) == won)
            .map(|t| t.size_zat.unwrap_or(0))
            .sum()
    };
    let (winning, losing) = (pool(true), pool(false));
    for t in tickets
        .iter()
        .filter(|t| t.side.as_deref() == Some(outcome))
    {
        let size = t.size_zat.context("ticket without a size")?;
        owed.push((
            t,
            "win",
            "won".to_string(),
            payout_zat(size, winning, losing)?,
        ));
    }
    Ok(owed)
}

/// Splits `zat` into canonical notes and schedules each at a random time in the window.
#[allow(clippy::too_many_arguments)]
pub fn schedule(
    tx: &Transaction<'_>,
    market_id: Option<&str>,
    receipt: &ReceiptRow,
    kind: &str,
    reason: &str,
    zat: u64,
    resolved_at: i64,
    window: Window,
) -> Result<usize> {
    let Some(recipient) = receipt.payout_address.as_deref() else {
        return Ok(0);
    };
    let span = u64::try_from(window.max - window.min + 1)?;
    let mut inserted = 0;
    for (i, note) in canonical_notes(zat).into_iter().enumerate() {
        let due_at = resolved_at + window.min + i64::try_from(random_u64()? % span)?;
        inserted += tx.execute(
            "INSERT OR IGNORE INTO payouts (market_id, receipt_txid, receipt_pool, receipt_index, note_index,
                 kind, reason, recipient, amount_zat, resolved_at, window_end, due_at, status, owner)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'scheduled', ?13)",
            params![
                market_id,
                receipt.txid,
                receipt.pool,
                receipt.output_index,
                i,
                kind,
                reason,
                recipient,
                note,
                resolved_at,
                resolved_at + window.max,
                due_at,
                random_owner()?.to_vec()
            ],
        )?;
    }
    Ok(inserted)
}

/// The network's transaction shape at `tip`: (expiry delta, marginal fee or `None` = 5,000).
pub fn network_shape(
    store: &Store,
    wallet: &Wallet,
    tip: u32,
) -> Result<(u32, Option<u64>, usize)> {
    let mut stmt = store
        .conn
        .prepare("SELECT expiry_delta, fee, actions FROM tx_samples WHERE height > ?1")?;
    let rows: Vec<(i64, Option<i64>, u32)> = stmt
        .query_map([tip.saturating_sub(SAMPLE_BLOCKS)], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<Result<_, _>>()?;
    let nu7 = wallet
        .net
        .params()
        .is_nu_active(NetworkUpgrade::Nu7, BlockHeight::from_u32(tip + 1));
    let fallback_expiry = if nu7 {
        POST_NU7_EXPIRY_DELTA
    } else {
        PRE_NU7_EXPIRY_DELTA
    };
    let mode = |values: Vec<i64>| -> Option<(i64, usize)> {
        let mut counts: BTreeMap<i64, usize> = BTreeMap::new();
        for v in &values {
            *counts.entry(*v).or_default() += 1;
        }
        (values.len() >= MIN_SAMPLES)
            .then(|| counts.into_iter().max_by_key(|(_, n)| *n))
            .flatten()
    };
    let expiry = mode(
        rows.iter()
            .map(|r| r.0)
            .filter(|d| (3..=1_000).contains(d))
            .collect(),
    )
    .map_or(fallback_expiry, |(d, _)| {
        u32::try_from(d).unwrap_or(fallback_expiry)
    });
    // Marginal fee of transactions paying exactly marginal × max(2, logical actions).
    let fees: Vec<i64> = rows
        .iter()
        .filter_map(|(_, fee, actions)| {
            let actions = i64::from((*actions).max(2));
            fee.filter(|f| *f > 0 && f % actions == 0)
                .map(|f| f / actions)
        })
        .collect();
    let marginal = mode(fees)
        .map(|(m, _)| u64::try_from(m).unwrap_or(STANDARD_MARGINAL_FEE))
        .filter(|m| (1_000..=50_000).contains(m) && *m != STANDARD_MARGINAL_FEE);
    Ok((expiry, marginal, rows.len()))
}

fn txid_of(hex_display: &str) -> Result<TxId> {
    let mut bytes: [u8; 32] = hex::decode(hex_display)?
        .try_into()
        .map_err(|_| anyhow!("txid must be 32 bytes"))?;
    bytes.reverse();
    Ok(TxId::from_bytes(bytes))
}

fn inputs_json(inputs: &[OutputRef]) -> String {
    Value::Array(
        inputs
            .iter()
            .map(|o| {
                let pool = match o.pool() {
                    PoolType::Shielded(ShieldedPool::Sapling) => 2,
                    PoolType::Shielded(ShieldedPool::Orchard) => 3,
                    PoolType::Shielded(ShieldedPool::Ironwood) => 4,
                    PoolType::Transparent => 0,
                };
                json!([o.txid().to_string(), pool, o.output_index()])
            })
            .collect(),
    )
    .to_string()
}

fn inputs_from_json(text: &str) -> Result<Vec<OutputRef>> {
    let value: Value = serde_json::from_str(text)?;
    value
        .as_array()
        .context("inputs")?
        .iter()
        .map(|row| {
            let pool = match row[1].as_u64() {
                Some(2) => PoolType::SAPLING,
                Some(3) => PoolType::ORCHARD,
                Some(4) => PoolType::IRONWOOD,
                _ => PoolType::TRANSPARENT,
            };
            Ok(OutputRef::new(
                txid_of(row[0].as_str().context("txid")?)?,
                pool,
                u32::try_from(row[2].as_u64().context("index")?)?,
            ))
        })
        .collect()
}

/// Updates broadcast payouts: mined → `mined`; past expiry and unmined → rescheduled now, to be
/// rebuilt from the same inputs; a failed broadcast of a live transaction is retried.
pub async fn track(
    store: &Store,
    wallet: &Wallet,
    tor: Option<&Tor>,
    tip: u32,
    now: i64,
) -> Result<()> {
    let rows: Vec<TrackRow> = {
        let mut stmt = store.conn.prepare(
            "SELECT id, txid, expiry_height, last_error, owner, inputs FROM payouts
             WHERE status = 'broadcast'",
        )?;
        stmt.query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })?
        .collect::<Result<_, _>>()?
    };
    if rows.is_empty() {
        return Ok(());
    }
    let wallet_db = rusqlite::Connection::open_with_flags(
        wallet.dir.join("wallet.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    for (id, txid, expiry, last_error, owner, inputs) in rows {
        let mut internal = hex::decode(&txid)?;
        internal.reverse();
        let mined: Option<u32> = wallet_db
            .query_row(
                "SELECT mined_height FROM transactions WHERE txid = ?1",
                [internal],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        if let Some(h) = mined {
            store.conn.execute(
                "UPDATE payouts SET status = 'mined', mined_height = ?2, last_error = NULL WHERE id = ?1",
                params![id, h],
            )?;
        } else if tip >= expiry {
            eprintln!(
                "payouts: payout {id} expired unmined at {expiry}; rebuilding from the same inputs"
            );
            // Reserve the freed inputs for this rebuild before any other payout can select them.
            if let Some(text) = inputs.as_deref() {
                let owner: [u8; 32] = owner.try_into().map_err(|_| anyhow!("bad lock owner"))?;
                wallet
                    .open()?
                    .lock_outputs(
                        &inputs_from_json(text)?,
                        LockOwner::new(owner),
                        BlockHeight::from_u32(tip + REBUILD_LOCK_BLOCKS),
                    )
                    .map_err(|e| anyhow!("locking payout {id}'s inputs: {e:?}"))?;
            }
            store.conn.execute(
                "UPDATE payouts SET status = 'scheduled', due_at = ?2, attempts = attempts + 1,
                     reason = reason || ' (rebuilt)' WHERE id = ?1",
                params![id, now],
            )?;
        } else if let (Some(error), Some(tor)) = (last_error, tor)
            && !error.starts_with(WITHHELD)
        {
            let db = wallet.open()?;
            if let Some(tx) = db.get_transaction(txid_of(&txid)?)? {
                let mut raw = vec![];
                tx.write(&mut raw)?;
                let result = send::broadcast(tor, &raw).await;
                store.conn.execute(
                    "UPDATE payouts SET last_error = ?2 WHERE id = ?1",
                    params![id, result.err().map(|e| format!("{e:#}"))],
                )?;
            }
        }
    }
    Ok(())
}

/// (id, recipient, zat, lock owner, inputs of an earlier attempt)
type DueRow = (i64, String, u64, Vec<u8>, Option<String>);

/// Builds and broadcasts every payout that is due, one transaction per note.
pub async fn send_due(
    store: &Store,
    wallet: &Wallet,
    tor: &Tor,
    tip: u32,
    now: i64,
) -> Result<usize> {
    if let Some(reason) = wallet
        .net
        .params()
        .payout_pause(BlockHeight::from_u32(tip))?
    {
        eprintln!("payouts: {reason}");
        return Ok(0);
    }
    let due: Vec<DueRow> = {
        let mut stmt = store.conn.prepare(
            "SELECT id, recipient, amount_zat, owner, inputs FROM payouts
             WHERE status = 'scheduled' AND due_at <= ?1 ORDER BY inputs IS NULL, due_at",
        )?;
        stmt.query_map([now], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<Result<_, _>>()?
    };
    if due.is_empty() {
        return Ok(0);
    }
    let (expiry_delta, marginal_fee, _) = network_shape(store, wallet, tip)?;
    // The rebuild test hook runs once per token value (testnet only).
    let token = std::env::var(ENV_TEST_WITHHOLD)
        .ok()
        .filter(|t| !t.is_empty() && t != "0" && wallet.net == crate::wallet::Net::Testnet);
    let mut withhold = match &token {
        Some(t) => store.conn.query_row(
            "SELECT COUNT(*) = 0 FROM state WHERE key = ?1",
            [format!("withheld:{t}")],
            |r| r.get::<_, bool>(0),
        )?,
        None => false,
    };
    let mut sent = 0;
    for (id, recipient, zat, owner, inputs) in due {
        let owner: [u8; 32] = owner.try_into().map_err(|_| anyhow!("bad lock owner"))?;
        let pinned = match inputs.as_deref() {
            Some(text) => Some((LockOwner::new(owner), inputs_from_json(text)?)),
            None => None,
        };
        let rebuild_of = pinned.as_ref().map(|(_, inputs)| inputs.clone());
        let withhold_this = withhold && rebuild_of.is_none();
        let built = send::build(
            wallet,
            &Spec {
                to: &recipient,
                zat,
                memo: None,
                expiry_delta: Some(if withhold_this {
                    TEST_WITHHOLD_EXPIRY_DELTA
                } else {
                    expiry_delta
                }),
                marginal_fee,
                pinned,
            },
        );
        let built = match built {
            Ok(b) => b,
            Err(e) => {
                // Usually the float's change is still confirming; the next wake retries.
                store.conn.execute(
                    "UPDATE payouts SET attempts = attempts + 1, last_error = ?2, due_at = ?3
                     WHERE status = 'scheduled' AND due_at <= ?4 AND (id = ?1 OR due_at <= ?4)",
                    params![id, format!("{e:#}"), now + RETRY_SECS, now],
                )?;
                eprintln!("payouts: a due payout could not be built yet: {e:#}");
                break;
            }
        };
        store.conn.execute(
            "UPDATE payouts SET status = 'broadcast', txid = ?2, expiry_height = ?3, inputs = ?4, fee_zat = ?5,
                 built_at = ?6, attempts = attempts + 1 WHERE id = ?1",
            params![
                id,
                built.txid.to_string(),
                built.expiry_height,
                inputs_json(&built.inputs),
                built.fee,
                now
            ],
        )?;
        if let Some(previous) = &rebuild_of {
            let same = previous.len() == built.inputs.len()
                && previous.iter().all(|p| built.inputs.contains(p));
            eprintln!(
                "payouts: payout {id} rebuilt after expiry from {} the same {} input(s)",
                if same { "exactly" } else { "NOT" },
                previous.len()
            );
        }
        if withhold_this {
            withhold = false;
            eprintln!(
                "payouts: test hook withheld payout {id}'s first broadcast (expiry {})",
                built.expiry_height
            );
            store.conn.execute(
                "UPDATE payouts SET last_error = ?2 WHERE id = ?1",
                params![id, WITHHELD],
            )?;
            store.conn.execute(
                "INSERT OR REPLACE INTO state (key, value) VALUES (?1, ?2)",
                params![
                    format!("withheld:{}", token.as_deref().unwrap_or_default()),
                    id
                ],
            )?;
            continue;
        }
        let result = send::broadcast(tor, &built.raw).await;
        store.conn.execute(
            "UPDATE payouts SET last_error = ?2 WHERE id = ?1",
            params![id, result.as_ref().err().map(|e| format!("{e:#}"))],
        )?;
        match result {
            Ok(()) => sent += 1,
            Err(e) => eprintln!(
                "payouts: broadcast failed, retrying while the transaction is live: {e:#}"
            ),
        }
    }
    Ok(sent)
}

/// The earliest scheduled payout time, for the run loop's wake-up.
pub fn next_due(store: &Store) -> Result<Option<i64>> {
    Ok(store.conn.query_row(
        "SELECT MIN(due_at) FROM payouts WHERE status = 'scheduled'",
        [],
        |r| r.get(0),
    )?)
}

/// On the fixed merge clock, consolidates the float when it is spread over many notes.
pub async fn maybe_merge(
    store: &Store,
    wallet: &Wallet,
    tor: &Tor,
    tip: u32,
    now: i64,
) -> Result<()> {
    let slot = now.div_euclid(MERGE_INTERVAL_SECS);
    let done: bool = store
        .conn
        .query_row("SELECT 1 FROM merges WHERE slot = ?1", [slot], |_| Ok(()))
        .optional()?
        .is_some();
    if done {
        return Ok(());
    }
    if now - slot * MERGE_INTERVAL_SECS > MERGE_GRACE_SECS {
        store.conn.execute(
            "INSERT INTO merges (slot, txid, notes, expiry_height, created_at) VALUES (?1, NULL, NULL, NULL, ?2)",
            params![slot, now],
        )?;
        return Ok(());
    }
    let pool = if wallet
        .net
        .params()
        .is_nu_active(NetworkUpgrade::Nu7, BlockHeight::from_u32(tip + 1))
    {
        ShieldedPool::Ironwood
    } else {
        ShieldedPool::Orchard
    };
    let notes = {
        let db = wallet.open()?;
        let account = wallet::account_id(&db)?;
        let (target, _) = db
            .get_target_and_anchor_heights(std::num::NonZeroU32::MIN.saturating_add(2))?
            .context("sync required")?;
        let notes =
            db.select_unspent_notes(account, &[pool], target, &[], LockFilter::Unfiltered)?;
        notes.sapling().len() + notes.orchard().len() + notes.ironwood().len()
    };
    let mut record = (None, None);
    if notes >= MERGE_MIN_NOTES {
        let (_, marginal_fee, _) = network_shape(store, wallet, tip)?;
        let built = send::build_merge(wallet, pool, marginal_fee)?;
        send::broadcast(tor, &built.raw).await?;
        eprintln!(
            "payouts: merged {notes} notes on the {}-hour clock",
            MERGE_INTERVAL_SECS / 3_600
        );
        record = (Some(built.txid.to_string()), Some(built.expiry_height));
    }
    store.conn.execute(
        "INSERT INTO merges (slot, txid, notes, expiry_height, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![slot, record.0, notes, record.1, now],
    )?;
    Ok(())
}

/// Per-market payout progress: (rows, rows mined, latest window end).
pub fn market_progress(store: &Store) -> Result<HashMap<String, (u32, u32, i64)>> {
    let mut stmt = store.conn.prepare(
        "SELECT market_id, COUNT(*), SUM(status = 'mined'), MAX(window_end) FROM payouts
         WHERE market_id IS NOT NULL GROUP BY market_id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?, r.get(3)?))))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Coarse status (`payoutRuns`): for each hour of resolutions whose payouts are all mined and
/// whose windows have closed, "resolved before HH:00: all sent by HH:00". Never txids.
pub fn runs(store: &Store, now: i64) -> Result<Vec<Value>> {
    let mut stmt = store.conn.prepare(
        "SELECT resolved_at / ?1, COUNT(*), SUM(status = 'mined'), MAX(window_end) FROM payouts
         WHERE resolved_at >= ?2 GROUP BY resolved_at / ?1 ORDER BY 1",
    )?;
    let rows = stmt.query_map(params![RUN_BUCKET_SECS, now - RUN_HISTORY_SECS], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, u32>(1)?,
            r.get::<_, u32>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    let mut out = vec![];
    for row in rows {
        let (bucket, total, mined, window_end) = row?;
        let sent_by = catalog::next_window_start(window_end - 1, RUN_BUCKET_SECS);
        if total == mined && now >= sent_by {
            out.push(json!({
                "resolvedBefore": catalog::iso((bucket + 1) * RUN_BUCKET_SECS),
                "allSentBy": catalog::iso(sent_by),
            }));
        }
    }
    Ok(out)
}

/// Counts and timing only (never amounts, recipients or txids), for `status`.
pub fn summary(store: &Store, now: i64) -> Result<Vec<String>> {
    let mut lines = vec![];
    let mut stmt = store.conn.prepare(
        "SELECT status, COUNT(*), MIN(due_at), MAX(due_at) FROM payouts GROUP BY status ORDER BY status",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, u32>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    let rel = |t: i64| {
        let d = t - now;
        if d >= 0 {
            format!("in {}h{:02}m", d / 3_600, (d % 3_600) / 60)
        } else {
            format!("{}h{:02}m ago", -d / 3_600, (-d % 3_600) / 60)
        }
    };
    for row in rows {
        let (status, count, first, last) = row?;
        lines.push(format!(
            "payouts   {status}: {count} note(s), due {} … {}",
            rel(first),
            rel(last)
        ));
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket(side: &str, size: u64) -> ReceiptRow {
        ReceiptRow {
            txid: format!("{side}{size}"),
            pool: 4,
            output_index: 0,
            status: "ticket".into(),
            reason: None,
            market_id: Some("btc-1h-2610172000".into()),
            side: Some(side.into()),
            size_zat: Some(size),
            value_zat: size,
            payout_address: Some("utest1x".into()),
        }
    }

    #[test]
    fn settlement() {
        let tickets: Vec<ReceiptRow> = ["U", "U", "U", "D", "D", "D"]
            .iter()
            .map(|s| ticket(s, 1_000_000))
            .collect();
        // 3 × 0.01 each side: a winner gets 0.01 + 0.0098 → rounded to the 0.001 grid = 0.02.
        let owed = settle("U", "majority", &tickets).expect("settles");
        assert_eq!(owed.len(), 3);
        assert!(
            owed.iter()
                .all(|(_, kind, _, zat)| *kind == "win" && *zat == 2_000_000)
        );
        assert_eq!(canonical_notes(2_000_000), vec![2_000_000]);
        // Refund outcomes return every stake.
        let refunds = settle("refund", "no-majority", &tickets).expect("refunds");
        assert_eq!(refunds.len(), 6);
        assert!(
            refunds
                .iter()
                .all(|(_, kind, _, zat)| *kind == "refund" && *zat == 1_000_000)
        );
        // A lone winner against a big losing side.
        let mut lopsided = vec![ticket("D", 1_000_000)];
        lopsided.extend((0..5).map(|_| ticket("U", 100_000_000)));
        let owed = settle("D", "majority", &lopsided).expect("settles");
        assert_eq!(
            owed[0].3,
            payout_zat(1_000_000, 1_000_000, 500_000_000).expect("payout")
        );
    }
}
