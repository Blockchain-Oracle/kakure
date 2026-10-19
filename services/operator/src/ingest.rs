//! Ingest: turns received outputs at market addresses into tickets, refunds or unrecoverable funds.
//!
//! The scan has already fetched every shielded transaction of every block and decrypted our
//! memos; this reads the wallet DB, so each tick re-derives the full receipt set (restart- and
//! reorg-safe). Checks, in order (plan §3, §13.3):
//! 1. a text memo that `decode_bet_memo` accepts, for this network, with a payout address that
//!    has an Orchard receiver (PD18) — otherwise no usable return address: unrecoverable;
//! 2. a nonce not seen before (the first by height, tx index, output wins) — else refund;
//! 3. amount == the memo's `z` (a ticket size) — else refund (dust under `REFUND_MIN_ZAT`);
//! 4. the market exists, is not cancelled and has the memo's side — else refund;
//! 5. mined at or after the first block with a timestamp ≥ `opensAt` and before the cutoff
//!    block `H_c` (the first block with a timestamp ≥ `cutoffAt`) — else refund.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use rusqlite::{Connection, OpenFlags};

use crate::{
    catalog::Kind,
    domain::{
        CLOSE_SIDES, EVENT_SIDES, MEMO_PREFIX, Network, REFUND_MIN_ZAT, check_payout_address,
        decode_bet_memo, ticket_hash,
    },
    store::{MarketRow, Receipt},
    wallet::{self, Wallet},
};

/// Received (external-scope, non-change, mined) Orchard-family outputs with their block position.
const OUTPUTS: &str = "
SELECT o.txid, o.tx_mined_height, COALESCE(t.tx_index, 0), o.output_pool, o.output_index, o.value,
       o.diversifier_index_be, o.memo
FROM v_tx_outputs o
JOIN transactions t ON t.id_tx = o.transaction_id
WHERE o.to_account_uuid IS NOT NULL
  AND o.is_change = 0
  AND o.recipient_key_scope = 0
  AND o.tx_mined_height IS NOT NULL
  AND o.output_pool IN (3, 4)
  AND o.diversifier_index_be IS NOT NULL
ORDER BY o.tx_mined_height, t.tx_index, o.output_pool, o.output_index";

/// Block timestamps and hashes of the scanned chain, with the running maximum per height.
pub struct BlockTimes {
    heights: Vec<u32>,
    times: Vec<i64>,
    running_max: Vec<i64>,
    hashes: Vec<String>,
}

/// Blocks in a median-time-past window (consensus: the 11 blocks ending at the block).
pub const MTP_WINDOW: usize = 11;

impl BlockTimes {
    pub fn load(wallet: &Wallet) -> Result<Self> {
        let conn = read_only(wallet)?;
        let mut stmt = conn.prepare("SELECT height, time, hash FROM blocks ORDER BY height")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, u32>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })?;
        let mut blocks = vec![];
        for row in rows {
            let (height, time, mut hash) = row?;
            hash.reverse();
            blocks.push((height, time, hex::encode(hash)));
        }
        Ok(Self::from_blocks(blocks))
    }

    pub fn from_blocks(blocks: Vec<(u32, i64, String)>) -> Self {
        let mut out = Self {
            heights: vec![],
            times: vec![],
            running_max: vec![],
            hashes: vec![],
        };
        let mut max = i64::MIN;
        for (height, time, hash) in blocks {
            max = max.max(time);
            out.heights.push(height);
            out.times.push(time);
            out.running_max.push(max);
            out.hashes.push(hash);
        }
        out
    }

    fn index(&self, height: u32) -> Option<usize> {
        self.heights.binary_search(&height).ok()
    }

    /// Highest block timestamp at or below `height`. A block at height `h` comes at or after the
    /// first block with timestamp ≥ `t` exactly when this is ≥ `t`.
    pub fn max_time_upto(&self, height: u32) -> Option<i64> {
        let n = self.heights.partition_point(|h| *h <= height);
        n.checked_sub(1).map(|i| self.running_max[i])
    }

    /// The first block whose timestamp is at or after `t` (`H_c` for `t = cutoffAt`).
    pub fn first_at_or_after(&self, t: i64) -> Option<u32> {
        let i = self.running_max.partition_point(|m| *m < t);
        self.heights.get(i).copied()
    }

    pub fn tip(&self) -> Option<u32> {
        self.heights.last().copied()
    }

    pub fn time_at(&self, height: u32) -> Option<i64> {
        self.index(height).map(|i| self.times[i])
    }

    pub fn hash_at(&self, height: u32) -> Option<&str> {
        self.index(height).map(|i| self.hashes[i].as_str())
    }

    /// Median-time-past of `height`: the median timestamp of the 11 blocks ending at it.
    pub fn mtp(&self, height: u32) -> Option<i64> {
        let end = self.index(height)?;
        let start = (end + 1).checked_sub(MTP_WINDOW)?;
        // The window must be contiguous heights.
        if self.heights[end] - self.heights[start] != (MTP_WINDOW - 1) as u32 {
            return None;
        }
        let mut window = self.times[start..=end].to_vec();
        window.sort_unstable();
        Some(window[MTP_WINDOW / 2])
    }

    /// The first scanned block whose median-time-past is at or after `t`.
    pub fn first_mtp_at_or_after(&self, t: i64) -> Option<u32> {
        self.heights
            .iter()
            .copied()
            .find(|h| self.mtp(*h).is_some_and(|m| m >= t))
    }
}

fn read_only(wallet: &Wallet) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        wallet.dir.join("wallet.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?)
}

/// One received output (also read by the chip deposits, `deposits.rs`).
pub(crate) struct Output {
    pub(crate) txid: String,
    pub(crate) height: u32,
    tx_index: u32,
    pub(crate) pool: u8,
    pub(crate) output_index: u32,
    pub(crate) value: u64,
    address_index: u32,
    pub(crate) memo: Option<String>,
}

pub(crate) fn outputs(wallet: &Wallet) -> Result<Vec<Output>> {
    let conn = read_only(wallet)?;
    let mut stmt = conn.prepare(OUTPUTS)?;
    let rows = stmt.query_map([], |r| {
        let mut txid: Vec<u8> = r.get(0)?;
        txid.reverse();
        let div: Vec<u8> = r.get(6)?;
        let memo: Option<Vec<u8>> = r.get(7)?;
        Ok(Output {
            txid: hex::encode(txid),
            height: r.get(1)?,
            tx_index: r.get(2)?,
            pool: r.get(3)?,
            output_index: r.get(4)?,
            value: r.get::<_, i64>(5)? as u64,
            address_index: div
                .iter()
                .fold(0u128, |acc, b| (acc << 8) | u128::from(*b))
                .try_into()
                .unwrap_or(u32::MAX),
            memo: memo.and_then(|m| wallet::memo_text(&m)),
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Classifies every output received at a published market address after its publication.
pub fn classify_all(
    wallet: &Wallet,
    network: Network,
    markets: &[MarketRow],
    published_tips: &HashMap<u32, u32>,
    blocks: &BlockTimes,
) -> Result<Vec<Receipt>> {
    let markets: HashMap<&str, &MarketRow> = markets.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut nonces = HashSet::new();
    let mut out = vec![];
    for o in outputs(wallet)? {
        // Index 0 (the default address) and outputs that predate an address's publication
        // (faucet funding, smoke tests) are house funds, not bets.
        let Some(published_tip) = published_tips.get(&o.address_index) else {
            continue;
        };
        if o.height <= *published_tip {
            continue;
        }
        out.push(classify(&o, network, &markets, &mut nonces, blocks));
    }
    Ok(out)
}

fn classify(
    o: &Output,
    network: Network,
    markets: &HashMap<&str, &MarketRow>,
    nonces: &mut HashSet<[u8; 16]>,
    blocks: &BlockTimes,
) -> Receipt {
    let mut receipt = Receipt {
        txid: o.txid.clone(),
        pool: o.pool,
        output_index: o.output_index,
        height: o.height,
        tx_index: o.tx_index,
        value_zat: o.value,
        address_index: o.address_index,
        status: "unrecoverable",
        reason: None,
        market_id: None,
        side: None,
        size_zat: None,
        nonce: None,
        payout_address: None,
        leaf: None,
    };
    let Some(text) = o.memo.as_deref() else {
        receipt.reason = Some("no-memo".into());
        return receipt;
    };
    let bet = match decode_bet_memo(text) {
        Ok(bet) => bet,
        Err(_) => {
            receipt.reason = Some(unreadable_reason(text, network).into());
            return receipt;
        }
    };
    if bet.network != network {
        receipt.reason = Some("wrong-network".into());
        return receipt;
    }
    receipt.market_id = Some(bet.market_id.clone());
    receipt.side = Some(bet.side.clone());
    receipt.size_zat = Some(bet.size_zat);
    receipt.nonce = Some(base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        bet.nonce,
    ));
    receipt.payout_address = Some(bet.payout_address.clone());

    let refund = |mut r: Receipt, reason: &str| {
        r.status = if r.value_zat >= REFUND_MIN_ZAT {
            "refund"
        } else {
            "dust"
        };
        r.reason = Some(reason.into());
        r
    };
    if !nonces.insert(bet.nonce) {
        return refund(receipt, "duplicate-nonce");
    }
    if o.value != bet.size_zat {
        return refund(receipt, "wrong-amount");
    }
    let Some(market) = markets.get(bet.market_id.as_str()) else {
        return refund(receipt, "unknown-market");
    };
    if market.cancelled {
        return refund(receipt, "cancelled");
    }
    let sides: &[&str] = match Kind::parse(&market.kind) {
        Some(Kind::Event) => &EVENT_SIDES,
        _ => &CLOSE_SIDES,
    };
    if !sides.contains(&bet.side.as_str()) {
        return refund(receipt, "wrong-side");
    }
    let chain_time = blocks.max_time_upto(o.height).unwrap_or(i64::MIN);
    if chain_time < market.opens_at {
        return refund(receipt, "not-open");
    }
    if chain_time >= market.cutoff_at || market.bet_height_cap.is_some_and(|cap| o.height >= cap) {
        return refund(receipt, "late");
    }
    receipt.status = "ticket";
    receipt.leaf = Some(hex::encode(ticket_hash(&bet)));
    receipt
}

fn unreadable_reason(text: &str, network: Network) -> &'static str {
    let first = text.lines().next().unwrap_or_default().trim();
    if !first.starts_with(MEMO_PREFIX) {
        return "not-a-bet-memo";
    }
    match first.rsplit(';').next().and_then(|f| f.strip_prefix("p=")) {
        Some(address) if check_payout_address(address, network).is_err() => "unpayable-address",
        _ => "malformed-memo",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_time_queries() {
        // Timestamps are not monotonic: block 12 is earlier than block 11.
        let blocks = BlockTimes::from_blocks(
            [(10, 100), (11, 130), (12, 120), (13, 160)]
                .into_iter()
                .map(|(h, t)| (h, t, String::new()))
                .collect(),
        );
        assert_eq!(blocks.max_time_upto(9), None);
        assert_eq!(blocks.max_time_upto(12), Some(130));
        // H_c for a cutoff of 125 is block 11 (the first with timestamp ≥ 125) ...
        assert_eq!(blocks.first_at_or_after(125), Some(11));
        // ... so a bet in block 12 is late even though block 12's own timestamp is before it.
        assert!(blocks.max_time_upto(12).expect("time") >= 125);
        assert!(blocks.max_time_upto(10).expect("time") < 125);
        assert_eq!(blocks.first_at_or_after(161), None);
        assert_eq!(blocks.mtp(13), None, "fewer than 11 blocks");
        let long = BlockTimes::from_blocks(
            (0..20)
                .map(|h| (h, i64::from(h) * 10, String::new()))
                .collect(),
        );
        assert_eq!(long.mtp(15), Some(100), "median of 50..=150");
        assert_eq!(long.first_mtp_at_or_after(100), Some(15));
    }
}
