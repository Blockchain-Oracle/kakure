//! Sync: compact-block scanning plus whole-block enhancement.
//!
//! For every block scanned, the full transaction of EVERY shielded transaction in that block
//! is fetched (`GetTransaction` per txid from the compact block), not only the wallet's own.
//! The server therefore sees the same request pattern whether or not a block holds anything
//! of ours. Each request group runs on its own isolated Tor circuit:
//! - chain metadata (tip, subtree roots) for the run;
//! - one circuit per batch of compact blocks (+ the batch's prior tree state);
//! - one circuit per chunk of `blocks_per_circuit` blocks of full transactions.
//!
//! Full transactions are fetched before the batch is scanned, so a failed fetch leaves the
//! batch unscanned and the next sync retries it. Memos are decrypted and stored right after
//! the batch is scanned.

use std::{collections::BTreeSet, convert::Infallible, time::Instant};

use anyhow::{Context, Result, bail, ensure};
use futures_util::{StreamExt, TryStreamExt, stream};
use orchard::tree::MerkleHashOrchard;
use zcash_client_backend::{
    data_api::{
        TransactionDataRequest, WalletCommitmentTrees, WalletRead, WalletWrite,
        chain::{self, BlockSource, CommitmentTreeRoot, scan_cached_blocks},
        wallet::decrypt_and_store_transaction,
    },
    proto::{
        compact_formats::CompactBlock,
        service::{self, BlockId, BlockRange, GetSubtreeRootsArg, ShieldedProtocol, TxFilter},
    },
};
use zcash_primitives::{merkle_tree::HashSer, transaction::Transaction};
use zcash_protocol::{
    TxId,
    consensus::{BlockHeight, BranchId},
};

use crate::{
    params::Params as Network,
    remote::{self, Lwd, Tor},
    wallet::{Db, Wallet},
};

/// Blocks downloaded and scanned per batch.
const BATCH_BLOCKS: u32 = 1_000;
/// How far below a continuity error to rewind before re-scanning.
const REORG_REWIND: u32 = 10;

pub struct SyncOpts {
    /// Concurrent full-transaction circuits.
    pub parallel: usize,
    /// Blocks whose transactions share one circuit.
    pub blocks_per_circuit: usize,
}

/// Shape of one fetched transaction, for matching the network's fee and expiry (plan §3).
#[derive(Clone, Copy, Debug)]
pub struct TxSample {
    pub height: u32,
    /// `expiry_height − mined height` (0 means the transaction had no expiry).
    pub expiry_delta: i64,
    /// Fee in zatoshi, when it is computable (no transparent inputs).
    pub fee: Option<i64>,
    /// ZIP 317 logical actions.
    pub actions: u32,
}

fn sample(tx: &Transaction, height: BlockHeight) -> Option<TxSample> {
    let transparent = tx.transparent_bundle();
    if transparent.is_some_and(|t| t.is_coinbase()) {
        return None;
    }
    let (t_in, t_out, t_out_value) = transparent.map_or((0, 0, 0), |t| {
        (
            t.vin.len(),
            t.vout.len(),
            t.vout
                .iter()
                .map(|o| i64::try_from(o.value().into_u64()).unwrap_or(i64::MAX))
                .sum(),
        )
    });
    let sapling = tx.sapling_bundle();
    let orchard = tx.orchard_bundle();
    let ironwood = tx.ironwood_bundle();
    let actions = t_in.max(t_out)
        + sapling.map_or(0, |b| {
            b.shielded_spends().len().max(b.shielded_outputs().len())
        })
        + orchard.map_or(0, |b| b.actions().len())
        + ironwood.map_or(0, |b| b.actions().len());
    let balance = sapling.map_or(0, |b| i64::from(*b.value_balance()))
        + orchard.map_or(0, |b| i64::from(*b.value_balance()))
        + ironwood.map_or(0, |b| i64::from(*b.value_balance()));
    let expiry = i64::from(u32::from(tx.expiry_height()));
    Some(TxSample {
        height: u32::from(height),
        expiry_delta: if expiry == 0 {
            0
        } else {
            expiry - i64::from(u32::from(height))
        },
        fee: (t_in == 0).then_some(balance - t_out_value),
        actions: u32::try_from(actions).unwrap_or(u32::MAX),
    })
}

/// What a sync saw.
#[derive(Default)]
pub struct SyncReport {
    pub samples: Vec<TxSample>,
}

#[derive(Default)]
struct Stats {
    blocks: u64,
    shielded_txs: u64,
    batches: u64,
}

/// Compact blocks held in memory for one batch.
struct MemBlocks(Vec<CompactBlock>);

impl BlockSource for MemBlocks {
    type Error = Infallible;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), chain::error::Error<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), chain::error::Error<WalletErrT, Self::Error>>,
    {
        let blocks = self
            .0
            .iter()
            .filter(|b| from_height.is_none_or(|h| b.height() >= h))
            .take(limit.unwrap_or(usize::MAX));
        for block in blocks {
            with_block(block.clone())?;
        }
        Ok(())
    }
}

/// The txids of every shielded transaction in a compact block. With no `pool_types` set,
/// lightwalletd returns only shielded data, but filter explicitly anyway.
fn shielded_txids(block: &CompactBlock) -> Vec<TxId> {
    block
        .vtx
        .iter()
        .filter(|tx| {
            !tx.spends.is_empty()
                || !tx.outputs.is_empty()
                || !tx.actions.is_empty()
                || !tx.ironwood_actions.is_empty()
        })
        .map(|tx| tx.txid())
        .collect()
}

pub async fn sync(wallet: &Wallet, tor: &Tor, opts: &SyncOpts) -> Result<SyncReport> {
    let mut report = SyncReport::default();
    let params = wallet.net.params();
    let mut db = wallet.open()?;
    let started = Instant::now();
    let mut stats = Stats::default();

    let mut meta = tor.circuit().await.context("metadata circuit")?;
    put_subtree_roots(&mut meta, &mut db).await?;

    loop {
        let tip = remote::latest_height(&mut meta).await?;
        db.update_chain_tip(tip)?;

        let Some(range) = db
            .suggest_scan_ranges()?
            .into_iter()
            .find(|r| r.block_range().start <= tip)
        else {
            break;
        };
        let start = range.block_range().start;
        let end = range
            .block_range()
            .end
            .min(tip + 1)
            .min(start + BATCH_BLOCKS);
        if start >= end {
            break;
        }

        // Compact blocks and the prior tree state, on this batch's own circuit.
        let mut lwd = tor.circuit().await.context("blocks circuit")?;
        let blocks = fetch_blocks(&mut lwd, start, end).await?;
        let chain_state = remote::tree_state(&mut lwd, start - 1)
            .await?
            .to_chain_state()?;
        drop(lwd);
        ensure!(
            blocks.first().map(|b| b.height()) == Some(start)
                && blocks.last().map(|b| b.height()) == Some(end - 1)
                && blocks.len() == usize::try_from(u32::from(end) - u32::from(start))?,
            "server returned an incomplete block range {start}..{end}"
        );

        // Whole-block enhancement: every shielded tx of every block in the batch.
        let wanted: Vec<(BlockHeight, Vec<TxId>)> = blocks
            .iter()
            .map(|b| (b.height(), shielded_txids(b)))
            .filter(|(_, txids)| !txids.is_empty())
            .collect();
        let txs = fetch_full_txs(tor, &params, wanted, opts).await?;

        let block_count = blocks.len();
        match scan_cached_blocks(
            &params,
            &MemBlocks(blocks),
            &mut db,
            start,
            &chain_state,
            block_count,
        ) {
            Ok(_) => {}
            Err(chain::error::Error::Scan(e)) if e.is_continuity_error() => {
                let to = e.at_height().saturating_sub(REORG_REWIND);
                eprintln!("sync: reorg at {}, rewinding to {to}", e.at_height());
                db.truncate_to_height(to)?;
                continue;
            }
            Err(e) => bail!("scanning {start}..{end}: {e}"),
        }

        stats.shielded_txs += txs.len() as u64;
        for (tx, height) in &txs {
            decrypt_and_store_transaction(&params, &mut db, tx, Some(*height))?;
            report.samples.extend(sample(tx, *height));
        }
        stats.blocks += block_count as u64;
        stats.batches += 1;
        eprintln!(
            "sync: scanned {start}..{end} ({block_count} blocks, {} shielded txs fetched whole)",
            txs.len()
        );
    }
    drop(meta);

    resolve_leftover_requests(tor, &params, &mut db, opts).await?;

    eprintln!(
        "sync: done in {:.1}s; {} blocks in {} batches, {} shielded txs fetched",
        started.elapsed().as_secs_f64(),
        stats.blocks,
        stats.batches,
        stats.shielded_txs
    );
    tor.report();
    Ok(report)
}

async fn put_subtree_roots(lwd: &mut Lwd, db: &mut Db) -> Result<()> {
    let sapling: Vec<CommitmentTreeRoot<sapling::Node>> =
        subtree_roots(lwd, ShieldedProtocol::Sapling, |b| {
            Ok(sapling::Node::read(b)?)
        })
        .await?;
    db.put_sapling_subtree_roots(0, &sapling)?;
    let orchard: Vec<CommitmentTreeRoot<MerkleHashOrchard>> =
        subtree_roots(lwd, ShieldedProtocol::Orchard, |b| {
            Ok(MerkleHashOrchard::read(b)?)
        })
        .await?;
    db.put_orchard_subtree_roots(0, &orchard)?;
    // Ironwood commitments are Orchard-shaped.
    let ironwood: Vec<CommitmentTreeRoot<MerkleHashOrchard>> =
        subtree_roots(lwd, ShieldedProtocol::Ironwood, |b| {
            Ok(MerkleHashOrchard::read(b)?)
        })
        .await?;
    db.put_ironwood_subtree_roots(0, &ironwood)?;
    Ok(())
}

async fn subtree_roots<H>(
    lwd: &mut Lwd,
    protocol: ShieldedProtocol,
    read: impl Fn(&[u8]) -> Result<H>,
) -> Result<Vec<CommitmentTreeRoot<H>>> {
    let mut req = GetSubtreeRootsArg::default();
    req.set_shielded_protocol(protocol);
    let mut stream = lwd.get_subtree_roots(req).await?.into_inner();
    let mut roots = vec![];
    while let Some(root) = stream.message().await? {
        roots.push(CommitmentTreeRoot::from_parts(
            BlockHeight::from_u32(u32::try_from(root.completing_block_height)?),
            read(&root.root_hash[..])?,
        ));
    }
    Ok(roots)
}

async fn fetch_blocks(
    lwd: &mut Lwd,
    start: BlockHeight,
    end: BlockHeight,
) -> Result<Vec<CompactBlock>> {
    let range = BlockRange {
        start: Some(BlockId {
            height: u64::from(start),
            hash: vec![],
        }),
        // `BlockRange.end` is inclusive.
        end: Some(BlockId {
            height: u64::from(end - 1),
            hash: vec![],
        }),
        pool_types: vec![],
    };
    let mut stream = lwd.get_block_range(range).await?.into_inner();
    let mut blocks = vec![];
    while let Some(block) = stream.message().await? {
        blocks.push(block);
    }
    Ok(blocks)
}

/// Fetches full transactions for each `(height, txids)` block, `blocks_per_circuit` blocks
/// per isolated circuit and `parallel` circuits at a time. Output keeps block order.
async fn fetch_full_txs(
    tor: &Tor,
    params: &Network,
    wanted: Vec<(BlockHeight, Vec<TxId>)>,
    opts: &SyncOpts,
) -> Result<Vec<(Transaction, BlockHeight)>> {
    let chunks: Vec<Vec<(BlockHeight, Vec<TxId>)>> = wanted
        .chunks(opts.blocks_per_circuit.max(1))
        .map(<[_]>::to_vec)
        .collect();
    let per_chunk: Vec<Vec<(Transaction, BlockHeight)>> = stream::iter(chunks)
        .map(|chunk| fetch_chunk(tor, params, chunk))
        .buffered(opts.parallel.max(1))
        .try_collect()
        .await?;
    Ok(per_chunk.into_iter().flatten().collect())
}

async fn fetch_chunk(
    tor: &Tor,
    params: &Network,
    chunk: Vec<(BlockHeight, Vec<TxId>)>,
) -> Result<Vec<(Transaction, BlockHeight)>> {
    let mut lwd = tor.circuit().await.context("transactions circuit")?;
    let mut out = vec![];
    for (height, txids) in chunk {
        for txid in txids {
            let req = TxFilter {
                block: None,
                index: 0,
                hash: txid.as_ref().to_vec(),
            };
            let raw = lwd
                .get_transaction(req)
                .await
                .with_context(|| format!("GetTransaction {txid} (block {height})"))?
                .into_inner();
            let tx = Transaction::read(&raw.data[..], BranchId::for_height(params, height))
                .with_context(|| format!("parsing {txid}"))?;
            ensure!(
                tx.txid() == txid,
                "server returned {} for {txid}",
                tx.txid()
            );
            out.push((tx, height));
        }
    }
    Ok(out)
}

/// Handles requests the wallet still has after scanning, without ever asking the server
/// for one transaction on its own:
/// - `Enhancement` of a mined tx: re-fetch its whole block (every shielded tx in it).
/// - `GetStatus` and unmined `Enhancement`: left for the scan that mines the tx, which
///   enhances it as part of its block.
async fn resolve_leftover_requests(
    tor: &Tor,
    params: &Network,
    db: &mut Db,
    opts: &SyncOpts,
) -> Result<()> {
    let mut heights = BTreeSet::new();
    let mut deferred = 0usize;
    for req in db.transaction_data_requests()? {
        #[allow(unreachable_patterns)]
        match req {
            TransactionDataRequest::Enhancement(txid) => match db.get_tx_height(txid)? {
                Some(h) => {
                    heights.insert(h);
                }
                None => deferred += 1,
            },
            _ => deferred += 1,
        }
    }
    if deferred > 0 {
        eprintln!("sync: {deferred} wallet request(s) wait for their tx to be mined");
    }
    if heights.is_empty() {
        return Ok(());
    }

    let mut wanted = vec![];
    let mut lwd = tor.circuit().await.context("block re-fetch circuit")?;
    for h in heights {
        let block = lwd
            .get_block(service::BlockId {
                height: u64::from(h),
                hash: vec![],
            })
            .await?
            .into_inner();
        ensure!(
            block.height() == h,
            "server returned block {} for {h}",
            block.height()
        );
        wanted.push((h, shielded_txids(&block)));
    }
    drop(lwd);
    let txs = fetch_full_txs(tor, params, wanted, opts).await?;
    for (tx, height) in &txs {
        decrypt_and_store_transaction(params, db, tx, Some(*height))?;
    }
    eprintln!("sync: re-enhanced {} txs from whole blocks", txs.len());
    Ok(())
}
