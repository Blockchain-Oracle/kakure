//! The engine tick: sync → catalog → openings → ingest → address pool → releases → markets →
//! publish.
//!
//! Runs on a fixed clock (`BATCH_INTERVAL_SECS`, aligned to UTC) and publishes a signed bundle
//! every tick whether or not anything changed (PD14/PD15). All state is in `engine.sqlite`, so a
//! restart continues the same sequence.
//!
//! A market's public `ticketCount`, `leaves` and totals are its released tickets only (PD28):
//! tickets stay pending, unpublished, until at least `MIN_NEW_TICKETS_PER_RELEASE` are pending,
//! and all of them join in one release. This holds for the first (unsealing) release and every
//! later one; at the final freeze, fewer pending are refunded in full and never counted.
//! Payouts are never sent from a tick: they go out between ticks at their own random times.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use serde_json::{Map, Value, json};
use zcash_protocol::consensus::{BlockHeight, NetworkUpgrade, Parameters as _};

use crate::{
    catalog::{self, Kind},
    domain::{
        ADDRESS_FIRST_INDEX, ADDRESS_LIST_SIZE, ADDRESS_RETIRE_MIN, CLOSE_SIDES,
        CLOSING_WARNING_BLOCKS, EVENT_SIDES, MIN_NEW_TICKETS_PER_RELEASE, MIN_TICKETS_PER_SIDE,
        Network, SCHEMA_VERSION,
    },
    history,
    ingest::{self, BlockTimes},
    payouts::{self, Window},
    publish::{LATEST_FILE, Publisher, sign_file},
    r2::R2,
    remote::Tor,
    scan::{self, SyncOpts},
    signing::{self, Keypair, canonical_json},
    store::{self, MarketRow, Store},
    venues::{self, Candle},
    wallet::{self, Net, Wallet},
};

/// Ticks run this long after each interval boundary, so venues have committed the hour's candle.
pub const TICK_OFFSET_SECS: i64 = 45;
/// After this long past `opensAt`, venues that still gave no answer count as "no vote".
pub const OPENING_GRACE_SECS: i64 = 20 * 60;
/// Paid (or resolved, nothing owed) markets leave the bundle this long after they close; older
/// bundles stay published, so receipts keep verifying.
pub const BUNDLE_RETENTION_SECS: i64 = 12 * catalog::HOUR_SECS;
/// Block spacing before and after NU7 (ZIP 208 / ZIP 218), for the "closing" warning.
const PRE_NU7_SPACING_SECS: i64 = 75;
const POST_NU7_SPACING_SECS: i64 = 25;
/// At least this many venues must give an opening reference for a 2-of-3 vote to be possible.
const MIN_OPENING_VENUES: usize = 2;
/// The run loop never wakes for sends more often than this (a send that keeps failing).
pub const MIN_WAKE_GAP_SECS: i64 = 20;

pub struct Engine {
    pub wallet: Wallet,
    pub store: Store,
    pub(crate) key: Keypair,
    pub(crate) http: reqwest::Client,
    pub(crate) publisher: Publisher,
    /// The payout window new markets state in their rules and use (O2).
    pub(crate) payout_window: Window,
    tick_secs: i64,
}

pub struct TickReport {
    pub seq: u64,
    pub tip: u32,
    pub markets: usize,
    pub tickets: usize,
    pub receipts: usize,
    pub addresses: String,
    pub uploaded: Option<usize>,
}

pub fn domain_network(net: Net) -> Network {
    match net {
        Net::Mainnet => Network::Mainnet,
        Net::Testnet => Network::Testnet,
    }
}

impl Engine {
    pub fn open(wallet: Wallet, tick_secs: i64) -> Result<Self> {
        // Refuses the payout-window override on mainnet, before anything is published (O2).
        let payout_window = payouts::window(wallet.net)?;
        if payout_window != Window::default() {
            eprintln!(
                "payouts: testnet window override {}–{} s, written into new markets' rules",
                payout_window.min, payout_window.max
            );
        }
        wallet.open()?;
        let key = signing::load(&wallet.dir)?;
        let store = Store::open(&wallet.dir.join("engine.sqlite"))?;
        let r2 = R2::from_env()?;
        if let Some(r2) = &r2 {
            eprintln!("publish: R2 configured ({})", r2.describe());
        }
        let publisher = Publisher::new(&wallet.dir, wallet.net.name(), r2);
        Ok(Self {
            wallet,
            store,
            key,
            http: venues::client()?,
            publisher,
            payout_window,
            tick_secs,
        })
    }

    pub fn public_dir(&self) -> std::path::PathBuf {
        self.publisher.dir()
    }

    pub async fn tick(&mut self, tor: Option<&Tor>, sync: &SyncOpts) -> Result<TickReport> {
        if let Some(tor) = tor {
            match scan::sync(&self.wallet, tor, sync).await {
                Ok(report) => self.store_samples(&report.samples)?,
                // Publish on the clock anyway, from what the wallet already has.
                Err(e) => {
                    eprintln!("tick: sync failed, publishing from the last scanned state: {e:#}")
                }
            }
        }
        let now = Utc::now().timestamp();
        let blocks = BlockTimes::load(&self.wallet)?;
        let tip = blocks
            .tip()
            .ok_or_else(|| anyhow!("the wallet has no scanned blocks yet (run sync)"))?;

        self.create_markets(now, tip)?;
        self.record_openings(now).await?;
        self.ensure_address_list(tip, now)?;

        let markets = self.store.markets()?;
        let receipts = ingest::classify_all(
            &self.wallet,
            domain_network(self.wallet.net),
            &markets,
            &self.store.published_tips()?,
            &blocks,
        )?;
        {
            let tx = self.store.conn.transaction()?;
            store::replace_receipts(&tx, &receipts, now)?;
            tx.commit()?;
        }
        self.rotate_addresses(tip, now)?;
        let seq = self.store.last_bundle()?.map_or(0, |(s, _, _)| s + 1);
        self.release_tickets(seq)?;
        self.finalize(&blocks, seq)?;
        self.resolve_markets(&blocks, tor, now).await?;
        self.schedule_refunds(now)?;
        payouts::track(&self.store, &self.wallet, tip, now)?;
        self.update_history(now).await?;
        let (seq, markets, tickets) = self.publish_bundle(now, tip)?;
        let uploaded = match self.publisher.r2() {
            None => None,
            Some(_) => match self.publisher.sync_r2(&self.http, &self.store, now).await {
                Ok(n) => Some(n),
                Err(e) => {
                    eprintln!("publish: R2 upload failed, retrying next tick: {e:#}");
                    Some(0)
                }
            },
        };
        Ok(TickReport {
            seq,
            tip,
            markets,
            tickets,
            receipts: receipts.len(),
            addresses: self
                .store
                .current_address_list()?
                .map(|(_, f)| f)
                .unwrap_or_default(),
            uploaded,
        })
    }

    /// When the run loop should next wake to send something.
    pub fn next_send(&self, now: i64) -> Result<Option<i64>> {
        payouts::next_due(&self.store, now)
    }

    /// Between ticks, at a send's own random time: one broadcast (a rebroadcast, a payout or the
    /// note merge), from the wallet as the last tick synced it. Never a sync here (O6).
    pub async fn payout_wake(&mut self, tor: &Tor) -> Result<usize> {
        let tip = BlockTimes::load(&self.wallet)?.tip().unwrap_or(0);
        let now = Utc::now().timestamp();
        if let Some(sent) = payouts::rebroadcast_due(&self.store, &self.wallet, tor, now).await? {
            return Ok(sent);
        }
        if let Some(sent) = payouts::send_due(&self.store, &self.wallet, tor, tip, now).await? {
            return Ok(sent);
        }
        if let Err(e) = payouts::maybe_merge(&self.store, &self.wallet, tor, tip, now).await {
            eprintln!("payouts: merge failed, retrying at a random time: {e:#}");
            payouts::replan_merge(&self.store, now)?;
        }
        Ok(0)
    }

    fn store_samples(&mut self, samples: &[scan::TxSample]) -> Result<()> {
        let tx = self.store.conn.transaction()?;
        for s in samples {
            tx.execute(
                "INSERT INTO tx_samples (height, expiry_delta, fee, actions) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![s.height, s.expiry_delta, s.fee, s.actions],
            )?;
        }
        if let Some(max) = samples.iter().map(|s| s.height).max() {
            tx.execute(
                "DELETE FROM tx_samples WHERE height < ?1",
                [max.saturating_sub(5_000)],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Creates the next window's markets (never retroactively: rules are fixed before opening).
    fn create_markets(&mut self, now: i64, tip: u32) -> Result<()> {
        let mut due = catalog::due_close_markets(now, self.payout_window)?;
        let pending_event = self
            .store
            .markets()?
            .iter()
            .any(|m| m.kind == Kind::Event.as_str() && m.closes_at > now);
        if !pending_event
            && let Some(event) = catalog::due_event_market(
                self.wallet.net,
                now,
                self.tick_secs,
                tip,
                self.payout_window,
            )?
        {
            // The NU7 market is created once; it never repeats.
            if !self.store.market_exists(&event.id)? {
                due.push(event);
            }
        }
        let tx = self.store.conn.transaction()?;
        for market in &due {
            if store::insert_market(&tx, market, now)? {
                eprintln!(
                    "catalog: created {} (opens {}, rules {})",
                    market.id,
                    catalog::iso(market.opens_at),
                    &market.rules_hash[..12]
                );
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Records each close market's opening reference once its window has started.
    async fn record_openings(&mut self, now: i64) -> Result<()> {
        let markets: Vec<MarketRow> = self
            .store
            .markets()?
            .into_iter()
            .filter(|m| {
                m.kind == Kind::Close.as_str()
                    && m.opens_at <= now
                    && m.opening.is_none()
                    && !m.cancelled
            })
            .collect();
        for market in markets {
            let asset = catalog::asset(&market.subject.to_lowercase())
                .ok_or_else(|| anyhow!("{}: unknown asset", market.id))?;
            let settled = self.store.opening_quotes(&market.id)?;
            let candle_start = market.opens_at - catalog::HOUR_SECS;
            let past_grace = now >= market.opens_at + OPENING_GRACE_SECS;
            let mut quotes: BTreeMap<&str, Option<String>> = settled
                .iter()
                .filter_map(|(venue, close)| {
                    asset
                        .venues
                        .iter()
                        .find(|v| v.venue.key() == venue)
                        .map(|v| (v.venue.key(), close.clone()))
                })
                .collect();
            for pair in &asset.venues {
                let key = pair.venue.key();
                if quotes.contains_key(key) {
                    continue;
                }
                let answer = match venues::candle(&self.http, pair, candle_start, now).await {
                    Ok(Candle::Close(close)) => Some(Some(close)),
                    Ok(Candle::NoTrades) => Some(None),
                    Ok(Candle::NotYet) => past_grace.then_some(None),
                    Err(e) => {
                        eprintln!("opening: {} {key}: {e:#}", market.id);
                        past_grace.then_some(None)
                    }
                };
                if let Some(close) = answer {
                    self.store
                        .put_quote(&market.id, key, close.as_deref(), now)?;
                    quotes.insert(key, close);
                }
            }
            if quotes.len() < asset.venues.len() {
                continue;
            }
            let opening: Map<String, Value> = quotes
                .iter()
                .filter_map(|(venue, close)| {
                    close
                        .as_ref()
                        .map(|c| ((*venue).to_string(), Value::String(c.clone())))
                })
                .collect();
            if opening.len() >= MIN_OPENING_VENUES {
                let json = canonical_json(&Value::Object(opening))?;
                eprintln!("opening: {} {json}", market.id);
                self.store.set_opening(&market.id, Some(&json))?;
            } else {
                eprintln!(
                    "opening: {} cancelled, only {} venue(s) answered",
                    market.id,
                    opening.len()
                );
                self.store.set_opening(&market.id, None)?;
            }
        }
        Ok(())
    }

    /// The first list: ADDRESS_LIST_SIZE Orchard-only addresses from diversifier index 1.
    fn ensure_address_list(&mut self, tip: u32, now: i64) -> Result<()> {
        if self.store.current_address_list()?.is_some() {
            return Ok(());
        }
        let mut db = self.wallet.open()?;
        let derived = wallet::addresses(
            &mut db,
            self.wallet.net,
            ADDRESS_FIRST_INDEX,
            ADDRESS_LIST_SIZE,
        )?;
        self.write_address_list(0, &[], &derived, tip, now)
    }

    /// Every batch: retires each listed address that received a payment plus random unused ones,
    /// a multiple of `ADDRESS_RETIRE_MIN` in all (never fewer), then refills from the next index.
    /// Every list therefore differs from the last by the same-sized random-looking set, so neither
    /// the paid address nor whether anything was paid shows (O9). Retired addresses still receive
    /// (the account's one IVK covers them), so a bettor holding an older list loses nothing.
    fn rotate_addresses(&mut self, tip: u32, now: i64) -> Result<()> {
        let live: HashSet<u32> = self
            .store
            .live_addresses()?
            .into_iter()
            .map(|(i, _)| i)
            .collect();
        let used: Vec<u32> = self
            .store
            .used_address_indices()?
            .into_iter()
            .filter(|i| live.contains(i))
            .collect();
        // If the list is larger than ADDRESS_LIST_SIZE (the size was lowered), also retire the
        // newest surplus.
        let target = ADDRESS_LIST_SIZE as usize;
        let mut active: Vec<u32> = live.iter().copied().filter(|i| !used.contains(i)).collect();
        active.sort_unstable();
        let mut retire = used.clone();
        if active.len() > target {
            retire.extend(active.split_off(target));
        }
        let decoys = decoy_count(used.len()).min(active.len());
        shuffle(&mut active)?;
        retire.extend(active.split_off(active.len() - decoys));
        let missing = target - active.len();
        let (seq, _) = self
            .store
            .current_address_list()?
            .context("no address list")?;
        let start = self
            .store
            .next_address_index()?
            .unwrap_or(ADDRESS_FIRST_INDEX);
        let derived = if missing == 0 {
            Vec::new()
        } else {
            let mut db = self.wallet.open()?;
            wallet::addresses(&mut db, self.wallet.net, start, u32::try_from(missing)?)?
        };
        self.write_address_list(seq + 1, &retire, &derived, tip, now)?;
        eprintln!(
            "addresses: list {} retires {} address(es) ({} used), adds {}",
            seq + 1,
            retire.len(),
            used.len(),
            derived.len()
        );
        Ok(())
    }

    /// Releases each open market's pending tickets once at least `MIN_NEW_TICKETS_PER_RELEASE`
    /// are pending, all at once, into bundle `seq` (PD28). Frozen markets never release again.
    fn release_tickets(&mut self, seq: u64) -> Result<()> {
        for m in self.store.markets()? {
            if m.outcome.is_some() || m.cutoff_hash.is_some() || m.cancelled {
                continue;
            }
            let released: HashSet<String> = self
                .store
                .released(&m.id)?
                .into_iter()
                .map(|(_, _, leaf)| leaf)
                .collect();
            let pending: Vec<(String, u64, String)> = self
                .store
                .tickets(&m.id)?
                .into_iter()
                .filter(|(_, _, leaf)| !released.contains(leaf))
                .collect();
            if pending.len() < MIN_NEW_TICKETS_PER_RELEASE as usize {
                continue;
            }
            let tx = self.store.conn.transaction()?;
            for (side, size, leaf) in &pending {
                tx.execute(
                    "INSERT INTO released_tickets (market_id, leaf, side, size_zat, seq)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![m.id, leaf, side, size, seq],
                )?;
            }
            tx.execute(
                "UPDATE markets SET released_seq = ?2, released_count = ?3 WHERE id = ?1",
                rusqlite::params![m.id, seq, released.len() + pending.len()],
            )?;
            tx.commit()?;
            eprintln!(
                "release: {} publishes {} pending ticket(s) in bundle {seq}",
                m.id,
                pending.len()
            );
        }
        Ok(())
    }

    fn write_address_list(
        &mut self,
        seq: u64,
        retire: &[u32],
        add: &[(u32, String)],
        tip: u32,
        now: i64,
    ) -> Result<()> {
        let tx = self.store.conn.transaction()?;
        for idx in retire {
            tx.execute(
                "UPDATE addresses SET retired_list = ?2 WHERE idx = ?1",
                rusqlite::params![idx, seq],
            )?;
        }
        for (idx, address) in add {
            tx.execute(
                "INSERT INTO addresses (idx, address, added_list, published_tip) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![idx, address, seq, tip],
            )?;
        }
        let addresses: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT address FROM addresses WHERE retired_list IS NULL ORDER BY address",
            )?;
            stmt.query_map([], |r| r.get(0))?
                .collect::<Result<_, _>>()?
        };
        anyhow::ensure!(
            addresses.len() == ADDRESS_LIST_SIZE as usize,
            "address list would hold {} addresses",
            addresses.len()
        );
        let file = sign_file(
            &self.key,
            &json!({
                "v": SCHEMA_VERSION,
                "network": self.wallet.net.name(),
                "seq": seq,
                "addresses": addresses,
            }),
        )?;
        let name = format!("addresses-{}.json", &file.hash[..8]);
        self.publisher.write(&name, &file.bytes, true)?;
        tx.execute(
            "INSERT INTO address_lists (seq, file, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![seq, name, now],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn closing_warning_secs(&self, tip: u32) -> i64 {
        let spacing = if self
            .wallet
            .net
            .params()
            .is_nu_active(NetworkUpgrade::Nu7, BlockHeight::from_u32(tip))
        {
            POST_NU7_SPACING_SECS
        } else {
            PRE_NU7_SPACING_SECS
        };
        CLOSING_WARNING_BLOCKS * spacing
    }

    /// Builds, signs and writes `bundle-<seq>.json`, then advances `latest.json`.
    fn publish_bundle(&mut self, now: i64, tip: u32) -> Result<(u64, usize, usize)> {
        let last = self.store.last_bundle()?;
        let seq = last.as_ref().map_or(0, |(s, _, _)| s + 1);
        let previous = last.map(|(_, _, hash)| hash);
        let (_, addresses) = self
            .store
            .current_address_list()?
            .context("no address list")?;
        let closing_warning = self.closing_warning_secs(tip);

        let mut markets_json = vec![];
        let mut ticket_total = 0;
        let progress = payouts::market_progress(&self.store)?;
        for m in self.store.markets()? {
            let market = self.market_json(&m, now, closing_warning, &progress)?;
            let state = market["state"].as_str().unwrap_or_default();
            let settled = state == "paid" || (state == "resolved" && !progress.contains_key(&m.id));
            if settled && m.closes_at < now - BUNDLE_RETENTION_SECS {
                continue;
            }
            ticket_total += market["ticketCount"].as_u64().unwrap_or(0) as usize;
            markets_json.push(market);
        }
        let market_count = markets_json.len();
        let bundle = json!({
            "v": SCHEMA_VERSION,
            "network": self.wallet.net.name(),
            "seq": seq,
            "publishedAt": catalog::iso(now),
            "previous": previous,
            "addresses": addresses,
            "markets": markets_json,
            "payoutRuns": payouts::runs(&self.store, now)?,
            "history": history::recent_files(&self.store, now)?,
        });
        let file = sign_file(&self.key, &bundle)?;
        let name = format!("bundle-{seq}.json");
        self.publisher.write(&name, &file.bytes, true)?;

        self.store.conn.execute(
            "INSERT INTO bundles (seq, file, hash, published_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![seq, name, file.hash, now],
        )?;

        let latest = sign_file(
            &self.key,
            &json!({
                "v": SCHEMA_VERSION,
                "network": self.wallet.net.name(),
                "seq": seq,
                "bundle": name,
                "bundleHash": file.hash,
                "publishedAt": catalog::iso(now),
            }),
        )?;
        self.publisher.write(LATEST_FILE, &latest.bytes, false)?;
        Ok((seq, market_count, ticket_total))
    }

    /// One market's bundle entry. Count, leaves and totals are the released tickets only (PD28),
    /// so they change exactly when `release_tickets` adds a batch of at least 3.
    fn market_json(
        &self,
        m: &MarketRow,
        now: i64,
        closing_warning: i64,
        progress: &std::collections::HashMap<String, (u32, u32, i64)>,
    ) -> Result<Value> {
        let kind = Kind::parse(&m.kind).ok_or_else(|| anyhow!("{}: bad kind", m.id))?;
        let sides: &[&str] = match kind {
            Kind::Close => &CLOSE_SIDES,
            Kind::Event => &EVENT_SIDES,
        };
        let tickets = self.store.released(&m.id)?;
        let mut totals: BTreeMap<&str, (u32, u64)> = sides.iter().map(|s| (*s, (0, 0))).collect();
        for (side, size, _) in &tickets {
            if let Some(t) = totals.get_mut(side.as_str()) {
                t.0 += 1;
                t.1 += size;
            }
        }
        let mut leaves: Vec<&str> = tickets.iter().map(|(_, _, leaf)| leaf.as_str()).collect();
        leaves.sort_unstable();
        let count = u32::try_from(tickets.len())?;
        let frozen = m.cutoff_hash.is_some();
        // Sealed until each released side has the minimum (D3).
        let sealed = totals.values().any(|(n, _)| *n < MIN_TICKETS_PER_SIDE);
        let released = if sealed {
            None
        } else {
            let seq = match m.released_seq {
                Some(s) => s,
                None => self.store.conn.query_row(
                    "SELECT COALESCE(MAX(seq), 0) FROM released_tickets WHERE market_id = ?1",
                    [&m.id],
                    |r| r.get(0),
                )?,
            };
            let sides_json = Value::Object(
                totals
                    .iter()
                    .map(|(side, (n, zat))| {
                        (
                            (*side).to_string(),
                            json!({ "tickets": n, "zat": zat.to_string() }),
                        )
                    })
                    .collect(),
            );
            Some((seq, sides_json))
        };

        let state = if let Some(outcome) = &m.outcome {
            match progress.get(&m.id) {
                Some((rows, mined, window_end)) if rows == mined && now >= *window_end => "paid",
                Some(_) if outcome == "refund" => "refunding",
                _ => "resolved",
            }
        } else if m.cancelled {
            "refunding"
        } else if frozen && (kind == Kind::Event || now >= m.closes_at) {
            "resolving"
        } else if frozen || now >= m.cutoff_at {
            "closed"
        } else if now < m.opens_at || (kind == Kind::Close && m.opening.is_none()) {
            "scheduled"
        } else if now >= m.cutoff_at - closing_warning {
            "closing"
        } else {
            "open"
        };

        let mut market = json!({
            "id": m.id,
            "kind": m.kind,
            "subject": m.subject,
            "window": m.window,
            "opensAt": catalog::iso(m.opens_at),
            "cutoffAt": catalog::iso(m.cutoff_at),
            "closesAt": catalog::iso(m.closes_at),
            "rules": serde_json::from_str::<Value>(&m.rules)?,
            "rulesHash": m.rules_hash,
            "state": state,
            "sealed": sealed,
            "ticketCount": count,
            "leaves": leaves,
        });
        let object = market.as_object_mut().expect("object");
        if let Some(opening) = &m.opening {
            object.insert("opening".into(), serde_json::from_str(opening)?);
        }
        if let Some((s, sides_json)) = released {
            object.insert("released".into(), json!({ "seq": s, "sides": sides_json }));
        }
        if let Some(h) = m.cutoff_height {
            object.insert("cutoffHeight".into(), json!(h));
        }
        if let Some(outcome) = &m.outcome {
            object.insert("outcome".into(), json!(outcome));
        } else if m.cancelled {
            object.insert("outcome".into(), json!("refund"));
        }
        if let Some(file) = &m.resolution_file {
            object.insert("resolution".into(), json!(file));
        }
        Ok(market)
    }
}

/// Unused addresses retired alongside `used` ones: the total is the next multiple of
/// `ADDRESS_RETIRE_MIN`, and at least one multiple even when nothing was paid.
fn decoy_count(used: usize) -> usize {
    let k = ADDRESS_RETIRE_MIN as usize;
    used.div_ceil(k).max(1) * k - used
}

/// Fisher–Yates with the system RNG.
fn shuffle<T>(items: &mut [T]) -> Result<()> {
    for i in (1..items.len()).rev() {
        let j = usize::try_from(payouts::random_u64()? % (i as u64 + 1))?;
        items.swap(i, j);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_retires_a_multiple_of_k() {
        let k = ADDRESS_RETIRE_MIN as usize;
        assert_eq!(decoy_count(0), k, "a batch with no payment still retires k");
        assert_eq!(decoy_count(1), k - 1);
        assert_eq!(decoy_count(k), 0);
        assert_eq!(decoy_count(k + 1), k - 1);
        for used in 0..40 {
            assert_eq!((used + decoy_count(used)) % k, 0);
        }
        let mut items: Vec<u32> = (0..50).collect();
        shuffle(&mut items).expect("shuffle");
        items.sort_unstable();
        assert_eq!(items, (0..50).collect::<Vec<_>>());
    }
}
