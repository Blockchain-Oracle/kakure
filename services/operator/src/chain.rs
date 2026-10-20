//! The chain side of `serve` (plan §00 REVAMP 2): its own task, beside the one-minute publication.
//!
//! Every `CHAIN_INTERVAL_SECS` it syncs the wallet to the tip over Tor (whole-block fetches, so
//! the light-wallet server can't tell which transactions are ours), records every chip deposit it
//! sees, shares the tip with the mint (deposit confirmations), tracks mined payouts, and builds or
//! broadcasts whatever withdrawal notes have come due, each at its own random time (`payouts.rs`).

use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

use anyhow::Result;
use chrono::Utc;

use crate::{
    deposits,
    ingest::BlockTimes,
    payouts,
    remote::Tor,
    rt_store,
    scan::{self, SyncOpts},
    store::Store,
    wallet::Wallet,
};

const CHAIN_INTERVAL_SECS: u64 = 15;
/// A sync that runs longer stops here; the next round carries on from what it fetched.
const SYNC_BUDGET_SECS: u64 = 60;
/// Fee and expiry samples are kept for this many recent blocks.
const SAMPLE_BLOCKS: u32 = 5_000;
/// The deposit address: one Orchard-only address at this diversifier index, apart from the pool
/// markets' addresses (from 1) and the house-funding address (900,000,000).
pub const DEPOSIT_ADDRESS_INDEX: u32 = 1_000_000_000;

pub struct Chain {
    pub wallet: Wallet,
    pub store: Store,
    pub tor: Tor,
    pub sync: SyncOpts,
    /// The scanned tip, shared with the mint.
    pub tip: Arc<AtomicU32>,
    /// How many deposits were last reported short, so the warning is printed when it changes, not every round.
    pub short_reported: usize,
}

impl Chain {
    pub async fn run(mut self) {
        loop {
            if let Err(e) = self.step().await {
                eprintln!("chain: {e:#}");
            }
            tokio::time::sleep(std::time::Duration::from_secs(CHAIN_INTERVAL_SECS)).await;
        }
    }

    async fn step(&mut self) -> Result<()> {
        let budget = std::time::Duration::from_secs(SYNC_BUDGET_SECS);
        match tokio::time::timeout(budget, scan::sync(&self.wallet, &self.tor, &self.sync)).await {
            Ok(Ok(report)) => store_samples(&mut self.store, &report.samples)?,
            Ok(Err(e)) => eprintln!("chain: sync failed, using the last scanned state: {e:#}"),
            Err(_) => eprintln!("chain: sync ran past {SYNC_BUDGET_SECS} s; continuing next round"),
        }
        let tip = BlockTimes::load(&self.wallet)?.tip().unwrap_or(0);
        self.tip.store(tip, Ordering::Relaxed);
        let found = deposits::scan(&self.wallet)?;
        let synced = rt_store::sync_deposit_outputs(&mut self.store.conn, &found)?;
        if synced.added > 0 {
            eprintln!("chain: {} new deposit output(s) at tip {tip}", synced.added);
        }
        if synced.dropped > 0 {
            eprintln!(
                "chain: {} deposit output(s) left the canonical chain (reorg); they no longer count",
                synced.dropped
            );
        }
        if synced.short.len() != self.short_reported {
            self.short_reported = synced.short.len();
            // Never the ids: a deposit id is a bearer claim on chips.
            eprintln!(
                "chain: {} deposit(s) have more minted than they now hold; they can't mint again",
                synced.short.len()
            );
        }
        let now = Utc::now().timestamp();
        payouts::track(&self.store, &self.wallet, tip, now)?;
        if let Some(sent) =
            payouts::broadcast_due(&self.store, &self.wallet, &self.tor, now).await?
        {
            if sent > 0 {
                eprintln!("chain: broadcast {sent} payout transaction(s)");
            }
        } else if payouts::has_due(&self.store, now)? {
            payouts::build_due(&self.store, &self.wallet, tip, now)?;
        } else if payouts::merge_due(&self.store, now)?
            && let Err(e) = payouts::maybe_merge(&self.store, &self.wallet, tip, now)
        {
            eprintln!("chain: note merge failed, retrying at a random time: {e:#}");
            payouts::replan_merge(&self.store, now)?;
        }
        Ok(())
    }
}

fn store_samples(store: &mut Store, samples: &[scan::TxSample]) -> Result<()> {
    let tx = store.conn.transaction()?;
    for s in samples {
        tx.execute(
            "INSERT INTO tx_samples (height, expiry_delta, fee, actions) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![s.height, s.expiry_delta, s.fee, s.actions],
        )?;
    }
    if let Some(max) = samples.iter().map(|s| s.height).max() {
        tx.execute(
            "DELETE FROM tx_samples WHERE height < ?1",
            [max.saturating_sub(SAMPLE_BLOCKS)],
        )?;
    }
    tx.commit()?;
    Ok(())
}
