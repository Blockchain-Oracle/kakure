//! Resolution: per-venue direction votes for close markets, chain reads for event markets, and
//! the signed evidence file `resolution-<marketId>.json` (Rust mirror of `resolutionSchema`).
//!
//! Close markets (plan §3, PD20): each venue votes Up, Down or Flat by comparing the close of its
//! committed 1-hour candle ending at `closesAt` with its opening reference (the close of the
//! candle ending at `opensAt`). A missing or zero-volume candle, or a venue without an opening
//! reference, is no vote. Two of three decide; anything else refunds every ticket.

use std::collections::BTreeMap;

use anyhow::{Context, Result, anyhow, ensure};
use serde::Serialize;
use zcash_client_backend::proto::service::{self, BlockId, BlockRange, TxFilter};

pub use crate::settle::{Vote, majority, vote};
use crate::{
    catalog::{self, Asset, HOUR_SECS},
    domain::FINALITY_CONFIRMATIONS,
    ingest::BlockTimes,
    remote::Lwd,
    venues::{self, Candle, Fetched},
};

/// NU7's consensus branch ID (ZIP 259), as read from bytes 8–11 of a coinbase transaction.
pub const NU7_BRANCH: u32 = 0x7719_0AD9;
/// After this long past `closesAt`, venues that still have no committed candle are no vote.
pub const CLOSE_GRACE_SECS: i64 = 20 * 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolSide {
    pub tickets: u32,
    /// Absent for a refunded market (N3): nothing is paid by size, so sizes stay private.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zat: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueVote {
    pub venue: String,
    pub pair: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opening: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close: Option<String>,
    pub vote: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResponse {
    pub source: String,
    pub url: String,
    pub fetched_at: String,
    pub status: u16,
    /// The raw response body, exactly as received.
    pub body: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainEvidence {
    pub server: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_height: Option<u32>,
    pub deadline: String,
    pub block_height: u32,
    pub block_hash: String,
    pub block_time: i64,
    pub median_time_past: i64,
    pub tip: u32,
    pub confirmations: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_id: Option<String>,
}

/// `resolution-<marketId>.json` (signed; `resolutionSchema` in `@kakure/domain`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionDoc {
    pub v: u32,
    pub network: String,
    pub market: String,
    pub kind: String,
    pub rules_hash: String,
    pub resolved_at: String,
    pub cutoff_height: u32,
    /// The signed final counts at `H_c`.
    pub totals: BTreeMap<String, PoolSide>,
    /// The counted tickets' hashes, sorted: lets a receipt be checked after the bundles that listed
    /// them are gone (bundles are kept 12 h). Already public in those bundles; nothing new is revealed.
    pub leaves: Vec<String>,
    /// What the sources say (`U`/`D`/`Y`/`N`), or `none` when they decide nothing.
    pub direction: String,
    /// What happens to the money: the winning side, or `refund`.
    pub outcome: String,
    /// majority | chain | thin-pool | no-majority | cancelled | servers-disagree
    pub reason: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub votes: Vec<VenueVote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain: Option<ChainEvidence>,
    pub responses: Vec<SourceResponse>,
}

fn response(source: &str, f: Fetched) -> SourceResponse {
    SourceResponse {
        source: source.to_string(),
        url: f.url,
        fetched_at: catalog::iso(f.fetched_at),
        status: f.status,
        body: f.body,
    }
}

/// The venue votes for a close market, once every venue has a committed close candle (or the
/// grace period is over). `None` while waiting.
pub async fn close_votes(
    http: &reqwest::Client,
    asset: &Asset,
    opening: &BTreeMap<String, String>,
    closes_at: i64,
    now: i64,
) -> Result<Option<(Vec<VenueVote>, Vec<SourceResponse>)>> {
    let past_grace = now >= closes_at + CLOSE_GRACE_SECS;
    let mut votes = vec![];
    let mut responses = vec![];
    for pair in &asset.venues {
        let key = pair.venue.key();
        let (close, fetched) =
            match venues::candle_raw(http, pair, closes_at - HOUR_SECS, now).await {
                Ok((Candle::Close(c), f)) => (Some(c), f),
                Ok((Candle::NoTrades, f)) => (None, f),
                Ok((Candle::NotYet, f)) if past_grace => (None, f),
                Ok((Candle::NotYet, _)) => return Ok(None),
                Err(e) if past_grace => {
                    eprintln!("resolve: {key}: {e:#} (no vote after the grace period)");
                    (None, None)
                }
                Err(e) => {
                    eprintln!("resolve: {key}: {e:#} (retrying next tick)");
                    return Ok(None);
                }
            };
        let open = opening.get(key).cloned();
        let v = vote(open.as_deref(), close.as_deref());
        votes.push(VenueVote {
            venue: key.to_string(),
            pair: pair.pair.to_string(),
            opening: open,
            close,
            vote: v.as_str().to_string(),
        });
        if let Some(f) = fetched {
            responses.push(response(key, f));
        }
    }
    Ok(Some((votes, responses)))
}

/// The result of a chain-read event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EventResult {
    Yes(u32),
    No(u32),
    Pending,
}

/// Testnet height event (plan §13.6): Yes if block `target` has MTP < `deadline` with 10
/// confirmations; No once the first block with MTP ≥ `deadline` has 10 confirmations and lies
/// below `target`, or block `target` itself is final with MTP ≥ `deadline`.
pub fn height_event(blocks: &BlockTimes, target: u32, deadline: i64) -> EventResult {
    let Some(tip) = blocks.tip() else {
        return EventResult::Pending;
    };
    let final_tip = (tip + 1).saturating_sub(FINALITY_CONFIRMATIONS);
    if target <= final_tip {
        return match blocks.mtp(target) {
            Some(m) if m < deadline => EventResult::Yes(target),
            Some(_) => EventResult::No(target),
            None => EventResult::Pending,
        };
    }
    match blocks.first_mtp_at_or_after(deadline) {
        Some(b) if b <= final_tip && b < target => EventResult::No(b),
        _ => EventResult::Pending,
    }
}

pub fn chain_evidence(
    blocks: &BlockTimes,
    server: &str,
    height: u32,
    target: Option<u32>,
    deadline: i64,
    branch_id: Option<u32>,
) -> Result<ChainEvidence> {
    let tip = blocks.tip().context("no blocks")?;
    Ok(ChainEvidence {
        server: server.to_string(),
        target_height: target,
        deadline: catalog::iso(deadline),
        block_height: height,
        block_hash: blocks
            .hash_at(height)
            .context("block not scanned")?
            .to_string(),
        block_time: blocks.time_at(height).context("block not scanned")?,
        median_time_past: blocks.mtp(height).context("no MTP window")?,
        tip,
        confirmations: tip + 1 - height,
        branch_id: branch_id.map(|b| format!("0x{b:08X}")),
    })
}

/// The consensus branch ID in block `height`'s coinbase (bytes 8–11, little-endian), read with
/// `GetBlockRange` over every pool (Zaino's `GetBlock` omits the coinbase) and `GetTransaction`.
pub async fn coinbase_branch(lwd: &mut Lwd, height: u32) -> Result<u32> {
    let id = BlockId {
        height: u64::from(height),
        hash: vec![],
    };
    let range = BlockRange {
        start: Some(id.clone()),
        end: Some(id),
        pool_types: [
            service::PoolType::Transparent,
            service::PoolType::Sapling,
            service::PoolType::Orchard,
            service::PoolType::Ironwood,
        ]
        .into_iter()
        .map(|p| p as i32)
        .collect(),
    };
    let mut stream = lwd.get_block_range(range).await?.into_inner();
    let block = stream
        .message()
        .await?
        .ok_or_else(|| anyhow!("no block {height}"))?;
    let coinbase = block
        .vtx
        .iter()
        .find(|tx| tx.index == 0)
        .ok_or_else(|| anyhow!("block {height} has no coinbase in the compact block"))?;
    let raw = lwd
        .get_transaction(TxFilter {
            block: None,
            index: 0,
            hash: coinbase.txid.clone(),
        })
        .await?
        .into_inner()
        .data;
    ensure!(raw.len() >= 12, "coinbase too short");
    Ok(u32::from_le_bytes(raw[8..12].try_into().expect("4 bytes")))
}

/// Mainnet NU7 event (plan §13.6): Yes if a block with branch `0x77190AD9` in its coinbase has
/// MTP < deadline with 10 confirmations; No once a final block has MTP ≥ deadline and is
/// pre-NU7. Returns the deciding block and its branch ID.
pub async fn nu7_event(
    lwd: &mut Lwd,
    blocks: &BlockTimes,
    lowest: u32,
    deadline: i64,
) -> Result<(EventResult, Option<u32>)> {
    let tip = blocks.tip().context("no blocks")?;
    let final_tip = (tip + 1).saturating_sub(FINALITY_CONFIRMATIONS);
    let branch = coinbase_branch(lwd, final_tip).await?;
    if branch == NU7_BRANCH {
        // NU7 blocks follow pre-NU7 ones on the NU7 chain: binary-search the activation block.
        let (mut lo, mut hi) = (lowest, final_tip);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if coinbase_branch(lwd, mid).await? == NU7_BRANCH {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        let mtp = blocks
            .mtp(lo)
            .context("activation block outside the scanned range")?;
        return Ok(if mtp < deadline {
            (EventResult::Yes(lo), Some(NU7_BRANCH))
        } else {
            (EventResult::No(lo), Some(NU7_BRANCH))
        });
    }
    match blocks.mtp(final_tip) {
        Some(m) if m >= deadline => Ok((EventResult::No(final_tip), Some(branch))),
        _ => Ok((EventResult::Pending, Some(branch))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refunded_totals_have_counts_only() {
        let refunded = PoolSide {
            tickets: 1,
            zat: None,
        };
        assert_eq!(
            serde_json::to_string(&refunded).expect("json"),
            r#"{"tickets":1}"#
        );
        let settled = PoolSide {
            tickets: 3,
            zat: Some("3000000".into()),
        };
        assert_eq!(
            serde_json::to_string(&settled).expect("json"),
            r#"{"tickets":3,"zat":"3000000"}"#
        );
    }

    #[test]
    fn vote_rule() {
        assert_eq!(vote(Some("81267.08"), Some("81300")), Vote::Up);
        assert_eq!(vote(Some("103.330"), Some("103.33")), Vote::Flat);
        assert_eq!(vote(Some("0.0790"), Some("0.07899")), Vote::Down);
        assert_eq!(
            vote(Some("9.5"), Some("10.1")),
            Vote::Up,
            "length before lexical order"
        );
        assert_eq!(vote(None, Some("1")), Vote::None, "no opening reference");
        assert_eq!(
            vote(Some("1"), None),
            Vote::None,
            "missing or zero-volume candle"
        );
        assert_eq!(majority(&[Vote::Up, Vote::Up, Vote::Down]), Some("U"));
        assert_eq!(majority(&[Vote::Down, Vote::None, Vote::Down]), Some("D"));
        assert_eq!(majority(&[Vote::Up, Vote::Down, Vote::Flat]), None);
        assert_eq!(majority(&[Vote::Up, Vote::None, Vote::None]), None);
        assert_eq!(majority(&[Vote::Flat, Vote::Flat, Vote::Up]), None);
    }

    #[test]
    fn height_event_rule() {
        // 30 blocks, 100 s apart, starting at height 1000, time 0.
        let blocks = BlockTimes::from_blocks(
            (0..30)
                .map(|i| (1000 + i, i64::from(i) * 100, String::new()))
                .collect(),
        );
        // Tip 1029, so heights ≤ 1020 have 10 confirmations.
        assert_eq!(
            height_event(&blocks, 1020, 1_000_000),
            EventResult::Yes(1020)
        );
        assert_eq!(height_event(&blocks, 1021, 1_000_000), EventResult::Pending);
        // MTP(1020) = time of 1015 = 1500.
        assert_eq!(height_event(&blocks, 1020, 1500), EventResult::No(1020));
        // Target far ahead, deadline passed at a final block: No.
        assert_eq!(height_event(&blocks, 5000, 1000), EventResult::No(1015));
        assert_eq!(height_event(&blocks, 5000, 1_000_000), EventResult::Pending);
    }
}
