//! Outgoing transactions: one recipient, `OvkPolicy::Discard`, ZIP 317 fees, broadcast over Tor.
//!
//! Only Orchard-family funds are spendable (Ironwood, legacy Orchard); a proposal that would
//! touch more than one pool (for example legacy Orchard → Ironwood, which publishes the
//! amount) is refused before anything is built. Payouts set an explicit expiry height and the
//! network's sampled fee, and a rebuild of an expired payout re-locks and prefers the exact
//! inputs of the first attempt (the same shape, L08).

use std::{convert::Infallible, str::FromStr};

use anyhow::{Result, anyhow, bail, ensure};
use rand::{rand_core::UnwrapErr, rngs::SysRng};
use secrecy::ExposeSecret;
use zcash_address::ZcashAddress;
use zcash_client_backend::data_api::locking::LockOwner;
use zcash_client_backend::{
    data_api::{
        Account as _, MaxSpendMode, OutputLockStore as _, WalletRead,
        wallet::{
            ConfirmationsPolicy, SpendingKeys, create_proposed_transactions,
            input_selection::{
                GreedyInputSelector, LockedInputPolicy, NonEmptyBTreeSet, SpendPolicy,
            },
            propose_send_max_transfer, propose_transfer,
        },
    },
    fees::{DustOutputPolicy, SplitPolicy, zip317::MultiOutputChangeStrategy},
    proposal::Proposal,
    proto::service::RawTransaction,
    wallet::{OutputRef, OvkPolicy},
};
use zcash_client_sqlite::{ReceivedNoteId, util::SystemClock};
use zcash_keys::{address::Address, keys::UnifiedSpendingKey};
use zcash_primitives::transaction::fees::zip317::{self, FeeRule};
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::{
    PoolType, ShieldedPool, TxId,
    consensus::BlockHeight,
    memo::{Memo, MemoBytes},
    value::Zatoshis,
};
use zip321::{Payment, TransactionRequest};

use crate::{
    remote::{Lwd, Tor},
    wallet::{self, Db, Wallet},
};

const POOLS: [PoolType; 4] = [
    PoolType::TRANSPARENT,
    PoolType::SAPLING,
    PoolType::ORCHARD,
    PoolType::IRONWOOD,
];

/// What to build.
pub struct Spec<'a> {
    pub to: &'a str,
    pub zat: u64,
    /// `None` sends the empty memo (payouts carry none: PD21).
    pub memo: Option<&'a str>,
    /// Expiry = target height + this; `None` keeps the builder's default.
    pub expiry_delta: Option<u32>,
    /// ZIP 317 marginal fee per logical action; `None` is the standard 5,000 zat.
    pub marginal_fee: Option<u64>,
    /// Re-lock these inputs to `owner` and prefer them (rebuilding an expired payout).
    pub pinned: Option<(LockOwner, Vec<OutputRef>)>,
}

/// A built (stored, not yet broadcast) transaction.
pub struct Built {
    pub txid: TxId,
    pub raw: Vec<u8>,
    pub target_height: u32,
    pub expiry_height: u32,
    pub fee: u64,
    pub inputs: Vec<OutputRef>,
}

pub fn fee_rule(marginal_fee: Option<u64>) -> Result<FeeRule> {
    match marginal_fee {
        None => Ok(FeeRule::standard()),
        Some(fee) => FeeRule::non_standard(
            Zatoshis::from_u64(fee).map_err(|e| anyhow!("fee: {e:?}"))?,
            zip317::GRACE_ACTIONS,
            zip317::P2PKH_STANDARD_INPUT_SIZE,
            zip317::P2PKH_STANDARD_OUTPUT_SIZE,
        )
        .ok_or_else(|| anyhow!("bad fee rule")),
    }
}

/// Builds and stores a single-recipient transaction (nothing leaves the machine).
pub fn build(wallet: &Wallet, spec: &Spec<'_>) -> Result<Built> {
    let params = wallet.net.params();
    // Kakure rule (plan §3): payout addresses must carry an Orchard receiver, on this network.
    match Address::decode(&params, spec.to) {
        Some(Address::Unified(ua)) if ua.has_orchard() => {}
        Some(_) => bail!("recipient must be a Unified Address with an Orchard receiver"),
        None => bail!("recipient is not a valid {} address", wallet.net.name()),
    }
    let recipient = ZcashAddress::from_str(spec.to).map_err(|e| anyhow!("recipient: {e}"))?;
    let memo = match spec.memo {
        Some(text) => MemoBytes::from(Memo::from_str(text).map_err(|e| anyhow!("memo: {e:?}"))?),
        None => MemoBytes::empty(),
    };
    let amount = Zatoshis::from_u64(spec.zat).map_err(|e| anyhow!("amount: {e:?}"))?;
    let payment = Payment::new(recipient, Some(amount), Some(memo), None, None, vec![])
        .map_err(|e| anyhow!("payment: {e:?}"))?;
    let request = TransactionRequest::new(vec![payment]).map_err(|e| anyhow!("request: {e:?}"))?;

    let mut db = wallet.open()?;
    let account = wallet::account(&db)?;
    let change = MultiOutputChangeStrategy::new(
        fee_rule(spec.marginal_fee)?,
        None,
        ShieldedPool::Ironwood,
        DustOutputPolicy::default(),
        SplitPolicy::single_output(),
    );
    let mut spend_policy =
        SpendPolicy::shielded_pools([ShieldedPool::Ironwood, ShieldedPool::Orchard]);
    if let Some((owner, inputs)) = &spec.pinned {
        let tip = db
            .chain_height()?
            .ok_or_else(|| anyhow!("wallet has no chain tip"))?;
        // Lock past the build; storing the transaction releases the lock again.
        db.lock_outputs(inputs, *owner, tip + 20)
            .map_err(|e| anyhow!("re-locking the payout's inputs: {e:?}"))?;
        spend_policy = spend_policy.with_locked_input_policy(LockedInputPolicy::PreferLocked(
            NonEmptyBTreeSet::singleton(*owner),
        ));
    }
    let proposal = propose_transfer::<_, _, _, _, Infallible>(
        &mut db,
        &params,
        account.id(),
        &GreedyInputSelector::new(),
        &change,
        request,
        ConfirmationsPolicy::default(),
        &spend_policy,
        None,
        None,
    )
    .map_err(|e| anyhow!("proposal: {e}"))?;
    create(wallet, &mut db, &proposal, spec.expiry_delta)
}

/// Merges every spendable note of `pool` into one note at the account's own default address.
pub fn build_merge(
    wallet: &Wallet,
    pool: ShieldedPool,
    marginal_fee: Option<u64>,
    expiry_delta: Option<u32>,
) -> Result<Built> {
    let params = wallet.net.params();
    let mut db = wallet.open()?;
    let account = wallet::account(&db)?;
    let (own, _) = db
        .get_last_generated_address_matching(
            account.id(),
            zcash_keys::keys::UnifiedAddressRequest::AllAvailableKeys,
        )?
        .map(|ua| (ua, ()))
        .ok_or_else(|| anyhow!("no default address"))?;
    let recipient =
        ZcashAddress::from_str(&own.encode(&params)).map_err(|e| anyhow!("own address: {e}"))?;
    let proposal = propose_send_max_transfer::<_, _, _, Infallible>(
        &mut db,
        &params,
        account.id(),
        &[pool],
        &fee_rule(marginal_fee)?,
        recipient,
        None,
        MaxSpendMode::MaxSpendable,
        ConfirmationsPolicy::default(),
        &LockedInputPolicy::Exclude,
        None,
    )
    .map_err(|e| anyhow!("merge proposal: {e}"))?;
    create(wallet, &mut db, &proposal, expiry_delta)
}

fn create(
    wallet: &Wallet,
    db: &mut Db,
    proposal: &Proposal<FeeRule, ReceivedNoteId>,
    expiry_delta: Option<u32>,
) -> Result<Built> {
    let params = wallet.net.params();
    ensure!(
        proposal.steps().len() == 1,
        "multi-step proposals are not supported"
    );
    let step = proposal.steps().first();
    let involved: Vec<PoolType> = POOLS.into_iter().filter(|p| step.involves(*p)).collect();
    if involved.len() != 1 {
        bail!("refusing to send: the transaction would cross pools {involved:?}");
    }
    let fee = step.balance().fee_required().into_u64();
    let inputs: Vec<OutputRef> = step
        .shielded_inputs()
        .map(|i| {
            i.notes()
                .iter()
                .map(|n| {
                    OutputRef::new(
                        *n.txid(),
                        PoolType::Shielded(n.note().pool()),
                        u32::from(n.output_index()),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let target_height = u32::from(proposal.min_target_height());
    let expiry = expiry_delta.map(|d| BlockHeight::from_u32(target_height + d));

    let account = wallet::account(db)?;
    let derivation = account
        .source()
        .key_derivation()
        .ok_or_else(|| anyhow!("view-only account cannot spend"))?;
    let seed = wallet.seed()?;
    let usk =
        UnifiedSpendingKey::from_seed(&params, seed.expose_secret(), derivation.account_index())
            .map_err(|e| anyhow!("deriving spending key: {e:?}"))?;
    drop(seed);
    let prover = LocalTxProver::bundled();
    let txids = create_proposed_transactions::<_, _, Infallible, _, Infallible, _>(
        db,
        &params,
        &SystemClock,
        &mut UnwrapErr(SysRng),
        &prover,
        &prover,
        &SpendingKeys::from_unified_spending_key(usk),
        OvkPolicy::Discard,
        proposal,
        expiry,
    )
    .map_err(|e| anyhow!("building transaction: {e}"))?;
    ensure!(
        txids.len() == 1,
        "expected one transaction, built {}",
        txids.len()
    );
    let txid = *txids.first();
    let tx = db
        .get_transaction(txid)?
        .ok_or_else(|| anyhow!("built tx {txid} not stored"))?;
    let mut raw = vec![];
    tx.write(&mut raw)?;
    Ok(Built {
        txid,
        raw,
        target_height,
        expiry_height: u32::from(tx.expiry_height()),
        fee,
        inputs,
    })
}

/// Broadcasts over a fresh isolated Tor circuit to the broadcast server (not the sync server,
/// where the network has a second one: O6).
pub async fn broadcast(tor: &Tor, raw: &[u8]) -> Result<()> {
    let mut lwd = tor.broadcast_circuit().await?;
    broadcast_on(&mut lwd, raw).await
}

/// Broadcasts on a circuit the caller opened (to read the tip first, as a light wallet does).
pub async fn broadcast_on(lwd: &mut Lwd, raw: &[u8]) -> Result<()> {
    let resp = lwd
        .send_transaction(RawTransaction {
            data: raw.to_vec(),
            height: 0,
        })
        .await?
        .into_inner();
    if resp.error_code != 0 {
        bail!(
            "broadcast rejected ({}): {}",
            resp.error_code,
            resp.error_message
        );
    }
    Ok(())
}

/// The CLI send (and bet): builder defaults, the given memo, broadcast at once.
pub async fn send(wallet: &Wallet, tor: &Tor, to: &str, zat: u64, memo: &str) -> Result<TxId> {
    let built = build(
        wallet,
        &Spec {
            to,
            zat,
            memo: Some(memo),
            expiry_delta: None,
            marginal_fee: None,
            pinned: None,
        },
    )?;
    eprintln!(
        "send: built {}: {} bytes, fee {} zat, {} input note(s), expiry height {}, target {}",
        built.txid,
        built.raw.len(),
        built.fee,
        built.inputs.len(),
        built.expiry_height,
        built.target_height
    );
    broadcast(tor, &built.raw).await?;
    tor.report();
    Ok(built.txid)
}
