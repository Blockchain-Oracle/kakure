//! Payouts: ZIP 317 fee, default expiry, `OvkPolicy::Discard`, broadcast over Tor.
//!
//! Only Orchard-family funds are spendable (Ironwood, legacy Orchard); a proposal that would
//! touch more than one pool (for example legacy Orchard → Ironwood, which publishes the
//! amount) is refused before anything is built.

use std::{convert::Infallible, str::FromStr};

use anyhow::{Context, Result, anyhow, bail, ensure};
use rand::{rand_core::UnwrapErr, rngs::SysRng};
use secrecy::ExposeSecret;
use zcash_address::ZcashAddress;
use zcash_client_backend::{
    data_api::{
        Account as _, WalletRead,
        wallet::{
            ConfirmationsPolicy, SpendingKeys, create_proposed_transactions,
            input_selection::{GreedyInputSelector, SpendPolicy},
            propose_transfer,
        },
    },
    fees::{DustOutputPolicy, SplitPolicy, StandardFeeRule, standard::MultiOutputChangeStrategy},
    proto::service::RawTransaction,
    wallet::OvkPolicy,
};
use zcash_client_sqlite::util::SystemClock;
use zcash_keys::{address::Address, keys::UnifiedSpendingKey};
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::{
    PoolType, ShieldedPool, TxId,
    memo::{Memo, MemoBytes},
    value::Zatoshis,
};
use zip321::{Payment, TransactionRequest};

use crate::{
    remote::Tor,
    wallet::{self, Wallet},
};

const POOLS: [PoolType; 4] = [
    PoolType::TRANSPARENT,
    PoolType::SAPLING,
    PoolType::ORCHARD,
    PoolType::IRONWOOD,
];

pub async fn send(wallet: &Wallet, tor: &Tor, to: &str, zat: u64, memo: &str) -> Result<TxId> {
    let params = wallet.net.params();

    // Kakure rule (plan §3): payout addresses must carry an Orchard receiver, on this network.
    match Address::decode(&params, to) {
        Some(Address::Unified(ua)) if ua.has_orchard() => {}
        Some(_) => bail!("recipient must be a Unified Address with an Orchard receiver"),
        None => bail!("recipient is not a valid {} address", wallet.net.name()),
    }
    let recipient = ZcashAddress::from_str(to).map_err(|e| anyhow!("recipient: {e}"))?;
    let memo = MemoBytes::from(Memo::from_str(memo).map_err(|e| anyhow!("memo: {e:?}"))?);
    let amount = Zatoshis::from_u64(zat).map_err(|e| anyhow!("amount: {e:?}"))?;
    let payment = Payment::new(recipient, Some(amount), Some(memo), None, None, vec![])
        .map_err(|e| anyhow!("payment: {e:?}"))?;
    let request = TransactionRequest::new(vec![payment]).map_err(|e| anyhow!("request: {e:?}"))?;

    let mut db = wallet.open()?;
    let account = wallet::account(&db)?;
    let derivation = account
        .source()
        .key_derivation()
        .ok_or_else(|| anyhow!("view-only account cannot spend"))?;
    let account_index = derivation.account_index();

    let change = MultiOutputChangeStrategy::new(
        StandardFeeRule::Zip317,
        None,
        ShieldedPool::Ironwood,
        DustOutputPolicy::default(),
        SplitPolicy::single_output(),
    );
    let selector = GreedyInputSelector::new();
    let spend_policy = SpendPolicy::shielded_pools([ShieldedPool::Ironwood, ShieldedPool::Orchard]);
    let proposal = propose_transfer::<_, _, _, _, Infallible>(
        &mut db,
        &params,
        account.id(),
        &selector,
        &change,
        request,
        ConfirmationsPolicy::default(),
        &spend_policy,
        None,
        None,
    )
    .map_err(|e| anyhow!("proposal: {e}"))?;

    ensure!(
        proposal.steps().len() == 1,
        "multi-step proposals are not supported"
    );
    let step = proposal.steps().first();
    let involved: Vec<PoolType> = POOLS.into_iter().filter(|p| step.involves(*p)).collect();
    if involved.len() != 1 {
        bail!("refusing to send: the transaction would cross pools {involved:?}");
    }
    let fee = step.balance().fee_required();
    eprintln!(
        "send: {zat} zat, fee {} zat (ZIP 317), pool {}, {} input note(s)",
        fee.into_u64(),
        involved[0],
        step.shielded_inputs().map_or(0, |i| i.notes().len())
    );

    let seed = wallet.seed()?;
    let usk = UnifiedSpendingKey::from_seed(&params, seed.expose_secret(), account_index)
        .map_err(|e| anyhow!("deriving spending key: {e:?}"))?;
    drop(seed);
    let prover = LocalTxProver::bundled();
    let txids = create_proposed_transactions::<_, _, Infallible, _, Infallible, _>(
        &mut db,
        &params,
        &SystemClock,
        &mut UnwrapErr(SysRng),
        &prover,
        &prover,
        &SpendingKeys::from_unified_spending_key(usk),
        OvkPolicy::Discard,
        &proposal,
        // The builder's default expiry.
        None,
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
    let mut raw = RawTransaction::default();
    tx.write(&mut raw.data)?;
    eprintln!(
        "send: built {txid}: {} bytes, expiry height {}, target {}",
        raw.data.len(),
        tx.expiry_height(),
        u32::from(proposal.min_target_height())
    );

    let mut lwd = tor.circuit().await.context("broadcast circuit")?;
    let resp = lwd.send_transaction(raw).await?.into_inner();
    if resp.error_code != 0 {
        bail!(
            "broadcast rejected ({}): {}",
            resp.error_code,
            resp.error_message
        );
    }
    tor.report();
    Ok(txid)
}
