//! Finality, resolution and settlement (plan §3, §13.3–13.6).
//!
//! 1. Freeze: once the cutoff block `H_c` has 10 confirmations, the wallet is fully scanned
//!    through `H_c + 9` and no memo enhancement is pending at or below it, the final counts are
//!    recorded with `H_c`'s block hash. They are the released tickets only (PD28): fewer than
//!    `MIN_NEW_TICKETS_PER_RELEASE` still pending are refunded in full and never counted. A later
//!    tick that finds a different `H_c` or hash (a reorg below `H_c + 10`) unfreezes the market,
//!    re-selects `H_c` and reconciles again.
//! 2. Resolve: venue votes (close markets) or a chain read (event markets), archived in a signed
//!    `resolution-<marketId>.json`.
//! 3. Settle: winners by `payout_zat`, everyone refunded when the pool is thin, the vote is
//!    split or flat, or the market was cancelled; each amount split into canonical notes.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, anyhow, ensure};
use rusqlite::params;
use serde_json::{Value, json};
use zcash_client_backend::data_api::{TransactionDataRequest, WalletRead as _};

use crate::{
    catalog::{self, Kind, NU7_SUBJECT},
    domain::{FINALITY_CONFIRMATIONS, MIN_TICKETS_PER_SIDE, SCHEMA_VERSION},
    engine::Engine,
    history,
    ingest::BlockTimes,
    payouts::{self, Window},
    publish::sign_file,
    remote::{Server, Tor},
    resolve::{self, EventResult, PoolSide, ResolutionDoc},
    signing::canonical_json,
    store::MarketRow,
};

/// The second, independent mainnet server for the NU7 cross-check (plan §13.6).
use crate::remote::MAINNET_SECOND_SERVER as NU7_SECOND_SERVER;

/// Payout reason of a ticket still pending at the final freeze (PD28): refunded in full.
const UNRELEASED: &str = "unreleased";

/// `H_c`, or for a height event the smaller of `H_c` and the target height.
fn effective_cutoff(m: &MarketRow, blocks: &BlockTimes) -> Option<u32> {
    let by_time = blocks.first_at_or_after(m.cutoff_at);
    match m.bet_height_cap {
        Some(cap) if blocks.tip().is_some_and(|t| t >= cap) => {
            Some(by_time.map_or(cap, |h| h.min(cap)))
        }
        _ => by_time,
    }
}

fn sides_of(kind: &str) -> &'static [&'static str] {
    if kind == Kind::Event.as_str() {
        &["Y", "N"]
    } else {
        &["U", "D"]
    }
}

impl Engine {
    /// Step 1: freeze qualifying ranges, or unfreeze them after a reorg. `seq` is the bundle
    /// about to be published.
    pub(crate) fn finalize(&mut self, blocks: &BlockTimes, seq: u64) -> Result<()> {
        let tip = blocks.tip().unwrap_or(0);
        let db = self.wallet.open()?;
        let fully_scanned = db
            .block_fully_scanned()?
            .map_or(0, |m| u32::from(m.block_height()));
        let mut pending = vec![];
        for request in db.transaction_data_requests()? {
            if let TransactionDataRequest::Enhancement(txid) = request
                && let Some(h) = db.get_tx_height(txid)?
            {
                pending.push(u32::from(h));
            }
        }
        drop(db);
        for m in self.store.markets()? {
            if m.outcome.is_some() {
                continue;
            }
            let candidate = effective_cutoff(&m, blocks);
            if let (Some(h), Some(hash)) = (m.cutoff_height, m.cutoff_hash.as_deref()) {
                if candidate == Some(h) && blocks.hash_at(h) == Some(hash) {
                    continue;
                }
                eprintln!(
                    "finality: {} reorg below H_c + {FINALITY_CONFIRMATIONS} (H_c was {h}); re-selecting",
                    m.id
                );
                self.store.conn.execute(
                    "UPDATE markets SET cutoff_height = NULL, cutoff_hash = NULL, final_count = NULL,
                         final_sides = NULL WHERE id = ?1",
                    [&m.id],
                )?;
                continue;
            }
            let Some(h) = candidate else {
                continue;
            };
            let bound = h + FINALITY_CONFIRMATIONS - 1;
            if tip < bound {
                continue;
            }
            if fully_scanned < bound || pending.iter().any(|p| *p <= bound) {
                eprintln!(
                    "finality: {} waits for scanning and memo enhancement through {bound}",
                    m.id
                );
                continue;
            }
            let mut totals: BTreeMap<&str, (u32, u64)> =
                sides_of(&m.kind).iter().map(|s| (*s, (0, 0))).collect();
            // Counted: released tickets whose payment is still a ticket below H_c. A released
            // ticket a reorg dropped (or made late) leaves the published set here, the only
            // time a count can go down.
            let live: HashSet<String> = self
                .store
                .tickets(&m.id)?
                .into_iter()
                .map(|(_, _, leaf)| leaf)
                .collect();
            let (counted, gone): (Vec<_>, Vec<_>) = self
                .store
                .released(&m.id)?
                .into_iter()
                .partition(|(_, _, leaf)| live.contains(leaf));
            for (_, _, leaf) in &gone {
                self.store.conn.execute(
                    "DELETE FROM released_tickets WHERE market_id = ?1 AND leaf = ?2",
                    params![m.id, leaf],
                )?;
                self.store.conn.execute(
                    "UPDATE markets SET released_seq = ?2 WHERE id = ?1",
                    params![m.id, seq],
                )?;
                eprintln!(
                    "finality: {} drops a released ticket the chain no longer has",
                    m.id
                );
            }
            let unreleased = live.len() - counted.len();
            let tickets = counted;
            for (side, size, _) in &tickets {
                if let Some(t) = totals.get_mut(side.as_str()) {
                    t.0 += 1;
                    t.1 += size;
                }
            }
            let sides = canonical_json(&Value::Object(
                totals
                    .iter()
                    .map(|(s, (n, zat))| {
                        (
                            (*s).to_string(),
                            json!({ "tickets": n, "zat": zat.to_string() }),
                        )
                    })
                    .collect(),
            ))?;
            self.store.conn.execute(
                "UPDATE markets SET cutoff_height = ?2, cutoff_hash = ?3, final_count = ?4, final_sides = ?5
                 WHERE id = ?1",
                params![m.id, h, blocks.hash_at(h), tickets.len(), sides],
            )?;
            eprintln!(
                "finality: {} frozen at H_c {h} with {} ticket(s); {unreleased} unreleased, refunded in full (PD28)",
                m.id,
                tickets.len()
            );
        }
        Ok(())
    }

    /// Steps 2 and 3 for every frozen, unresolved market.
    pub(crate) async fn resolve_markets(
        &mut self,
        blocks: &BlockTimes,
        tor: Option<&Tor>,
        now: i64,
    ) -> Result<()> {
        for m in self.store.markets()? {
            let (Some(cutoff_height), Some(_), None) =
                (m.cutoff_height, &m.cutoff_hash, &m.outcome)
            else {
                continue;
            };
            let final_sides: BTreeMap<String, PoolSide> = {
                let raw: Value =
                    serde_json::from_str(m.final_sides.as_deref().context("final counts")?)?;
                raw.as_object()
                    .context("final counts")?
                    .iter()
                    .map(|(s, v)| {
                        Ok((
                            s.clone(),
                            PoolSide {
                                tickets: u32::try_from(v["tickets"].as_u64().context("tickets")?)?,
                                zat: v["zat"].as_str().context("zat")?.to_string(),
                            },
                        ))
                    })
                    .collect::<Result<_>>()?
            };
            let Some(evidence) = self.evidence(&m, blocks, tor, now).await? else {
                continue;
            };
            let (direction, votes, chain, responses) = evidence;
            // Resolution time is after every source was read.
            let now = chrono::Utc::now().timestamp();
            let thin = final_sides
                .values()
                .any(|s| s.tickets < MIN_TICKETS_PER_SIDE);
            let (outcome, reason) = if m.cancelled {
                ("refund".to_string(), "cancelled")
            } else if thin {
                ("refund".to_string(), "thin-pool")
            } else if direction == "none" {
                ("refund".to_string(), "no-majority")
            } else if direction == "disagree" {
                ("refund".to_string(), "servers-disagree")
            } else if m.kind == Kind::Close.as_str() {
                (direction.clone(), "majority")
            } else {
                (direction.clone(), "chain")
            };
            let released: HashSet<String> = self
                .store
                .released(&m.id)?
                .into_iter()
                .map(|(_, _, leaf)| leaf)
                .collect();
            let (tickets, unreleased): (Vec<_>, Vec<_>) = self
                .store
                .market_receipts(&m.id)?
                .into_iter()
                .filter(|r| r.status == "ticket")
                .partition(|r| r.leaf.as_ref().is_some_and(|l| released.contains(l)));
            ensure!(
                Some(u32::try_from(tickets.len())?) == m.final_count
                    && unreleased.len() < crate::domain::MIN_NEW_TICKETS_PER_RELEASE as usize,
                "{}: ticket set changed after the freeze",
                m.id
            );
            let doc = ResolutionDoc {
                v: SCHEMA_VERSION,
                network: self.wallet.net.name().to_string(),
                market: m.id.clone(),
                kind: m.kind.clone(),
                rules_hash: m.rules_hash.clone(),
                resolved_at: catalog::iso(now),
                cutoff_height,
                totals: final_sides,
                direction,
                outcome: outcome.clone(),
                reason: reason.to_string(),
                votes,
                chain,
                responses,
            };
            let file = sign_file(&self.key, &serde_json::to_value(&doc)?)?;
            let name = format!("resolution-{}.json", m.id);
            self.publisher.write(&name, &file.bytes, true)?;

            // The window this market's signed rules state (O2).
            let window = Window::of_market(&m);
            let mut owed = payouts::settle(&outcome, reason, &tickets)?;
            for t in &unreleased {
                owed.push((t, "refund", UNRELEASED.to_string(), t.value_zat));
            }
            let tx = self.store.conn.transaction()?;
            tx.execute(
                "UPDATE markets SET outcome = ?2, outcome_reason = ?3, resolution_file = ?4, resolved_at = ?5
                 WHERE id = ?1",
                params![m.id, outcome, reason, name, now],
            )?;
            let mut notes = 0;
            for (receipt, kind, why, zat) in &owed {
                notes +=
                    payouts::schedule(&tx, Some(&m.id), receipt, kind, why, *zat, now, window)?;
            }
            tx.commit()?;
            eprintln!(
                "resolve: {} → {outcome} ({reason}); {} payment(s) in {notes} note(s), {}–{} s after resolution{}",
                m.id,
                owed.len(),
                window.min,
                window.max,
                if unreleased.is_empty() {
                    String::new()
                } else {
                    format!(
                        "; {} unreleased ticket(s) refunded in full",
                        unreleased.len()
                    )
                }
            );
            if m.kind == Kind::Close.as_str()
                && let Err(e) = history::fetch_path(&self.store, &self.http, &m, now).await
            {
                eprintln!("history: {} price path not fetched yet: {e:#}", m.id);
            }
        }
        Ok(())
    }

    /// The direction (`U`/`D`/`Y`/`N`, `none`, or `disagree`), votes, chain evidence and raw
    /// responses, or `None` while the sources cannot decide yet.
    #[allow(clippy::type_complexity)]
    async fn evidence(
        &self,
        m: &MarketRow,
        blocks: &BlockTimes,
        tor: Option<&Tor>,
        now: i64,
    ) -> Result<
        Option<(
            String,
            Vec<resolve::VenueVote>,
            Option<resolve::ChainEvidence>,
            Vec<resolve::SourceResponse>,
        )>,
    > {
        if m.cancelled {
            return Ok(Some(("none".into(), vec![], None, vec![])));
        }
        if m.kind == Kind::Close.as_str() {
            if now < m.closes_at {
                return Ok(None);
            }
            let asset = catalog::asset(&m.subject.to_lowercase()).context("unknown asset")?;
            let opening: BTreeMap<String, String> = serde_json::from_str(
                m.opening
                    .as_deref()
                    .context("open market without an opening")?,
            )?;
            let Some((votes, responses)) =
                resolve::close_votes(&self.http, asset, &opening, m.closes_at, now).await?
            else {
                return Ok(None);
            };
            let parsed: Vec<resolve::Vote> = votes
                .iter()
                .map(|v| match v.vote.as_str() {
                    "U" => resolve::Vote::Up,
                    "D" => resolve::Vote::Down,
                    "flat" => resolve::Vote::Flat,
                    _ => resolve::Vote::None,
                })
                .collect();
            let direction = resolve::majority(&parsed).unwrap_or("none").to_string();
            return Ok(Some((direction, votes, None, responses)));
        }
        if m.subject == NU7_SUBJECT {
            let Some(tor) = tor else {
                return Ok(None);
            };
            let lowest = blocks
                .first_at_or_after(m.opens_at)
                .context("no scanned block after opening")?;
            let mut first = tor.circuit().await?;
            let (a, branch) = resolve::nu7_event(&mut first, blocks, lowest, m.closes_at).await?;
            let mut second = tor.circuit_to(&Server::parse(NU7_SECOND_SERVER)?).await?;
            let (b, _) = resolve::nu7_event(&mut second, blocks, lowest, m.closes_at).await?;
            let (direction, height) = match (&a, &b) {
                (EventResult::Pending, _) | (_, EventResult::Pending) => return Ok(None),
                (x, y) if x != y => ("disagree", None),
                (EventResult::Yes(h), _) => ("Y", Some(*h)),
                (EventResult::No(h), _) => ("N", Some(*h)),
            };
            let chain = match height {
                Some(h) => Some(resolve::chain_evidence(
                    blocks,
                    &format!("{} and {NU7_SECOND_SERVER}", tor.server()),
                    h,
                    None,
                    m.closes_at,
                    branch,
                )?),
                None => None,
            };
            return Ok(Some((direction.into(), vec![], chain, vec![])));
        }
        let target = m
            .target_height
            .ok_or_else(|| anyhow!("{}: no target height", m.id))?;
        let (direction, height) = match resolve::height_event(blocks, target, m.closes_at) {
            EventResult::Pending => return Ok(None),
            EventResult::Yes(h) => ("Y", h),
            EventResult::No(h) => ("N", h),
        };
        let server = tor.map_or_else(
            || "the scanned chain".to_string(),
            |t| t.server().to_string(),
        );
        let chain =
            resolve::chain_evidence(blocks, &server, height, Some(target), m.closes_at, None)?;
        Ok(Some((direction.into(), vec![], Some(chain), vec![])))
    }

    /// Refunds owed outside a market's settlement (late, wrong amount, duplicate nonce, wrong
    /// side, not open, unknown market): scheduled once their market has resolved (or never
    /// existed), so they ride in the same random payout windows.
    ///
    /// Their window starts on the fixed clock, never at the payment's arrival (O20): at the
    /// market's resolution, or (no market, or the payment came after it resolved) at the first
    /// whole hour after the tick that saw the payment, the same hour boundaries markets resolve on.
    pub(crate) fn schedule_refunds(&mut self, now: i64) -> Result<()> {
        let markets: BTreeMap<String, MarketRow> = self
            .store
            .markets()?
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect();
        let pending = self.store.unscheduled_refunds()?;
        let tx = self.store.conn.transaction()?;
        let mut notes = 0;
        for r in &pending {
            let market = r.market_id.as_deref().and_then(|id| markets.get(id));
            if market.is_some_and(|m| m.outcome.is_none()) {
                continue;
            }
            let next_hour = catalog::next_window_start(r.first_seen, catalog::HOUR_SECS);
            let start = match market.and_then(|m| m.resolved_at) {
                Some(resolved) if r.first_seen <= resolved => resolved,
                _ => next_hour,
            };
            if start > now {
                continue;
            }
            let window = market.map_or(self.payout_window, Window::of_market);
            let reason = r.reason.as_deref().unwrap_or("refund");
            notes += payouts::schedule(
                &tx,
                market.map(|m| m.id.as_str()),
                r,
                "refund",
                reason,
                r.value_zat,
                start,
                window,
            )?;
        }
        tx.commit()?;
        if notes > 0 {
            eprintln!("payouts: scheduled {notes} refund note(s)");
        }
        Ok(())
    }

    /// Retries price paths that were not fetched at resolution, then writes finished days.
    pub(crate) async fn update_history(&mut self, now: i64) -> Result<()> {
        let markets = self.store.markets()?;
        for m in &markets {
            if m.kind != Kind::Close.as_str() || m.outcome.is_none() {
                continue;
            }
            let have: bool = self.store.conn.query_row(
                "SELECT COUNT(*) > 0 FROM price_paths WHERE market_id = ?1",
                [&m.id],
                |r| r.get(0),
            )?;
            let published: bool = self.store.conn.query_row(
                "SELECT COUNT(*) > 0 FROM history_files WHERE day = strftime('%Y%m%d', ?1, 'unixepoch')",
                [m.opens_at],
                |r| r.get(0),
            )?;
            if !have
                && !published
                && let Err(e) = history::fetch_path(&self.store, &self.http, m, now).await
            {
                eprintln!("history: {} price path not fetched yet: {e:#}", m.id);
            }
        }
        history::publish_days(
            &self.store,
            &self.key,
            &self.publisher,
            self.wallet.net.name(),
            &markets,
            now,
        )
    }
}
