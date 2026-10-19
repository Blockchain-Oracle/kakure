//! Chip deposits (plan §00 REVAMP 2): a shielded payment to the operator's deposit address whose
//! memo names a deposit id, `kakure:d1;<32 hex>`.
//!
//! The client draws the 16-byte id itself and builds the payment request (ZIP 321) on the device,
//! so nothing reaches the operator before the payment does. Once the payment has
//! `DEPOSIT_CONFIRMATIONS`, the client asks the mint (through the relay) to sign blinded chips
//! worth it: the id is a bearer secret that only the payer and the operator ever see (it travels
//! encrypted in the memo). Several payments with one id add up. Anything else received (a memo we
//! don't recognise) is not a deposit and is never minted.

use anyhow::Result;

use crate::{ingest, rt_store::DepositOutput, wallet::Wallet};

pub const DEPOSIT_MEMO_PREFIX: &str = "kakure:d1;";
pub const DEPOSIT_ID_HEX: usize = 32;

/// Confirmations a deposit needs before it mints (25 s blocks on testnet since NU7; 75 s mainnet).
pub fn confirmations(mainnet: bool) -> u32 {
    if mainnet { 3 } else { 2 }
}

/// The deposit id a memo names: its first line exactly `kakure:d1;` + 32 lowercase hex.
pub fn deposit_id(memo: &str) -> Option<String> {
    let first = memo.lines().next()?.trim();
    let id = first.strip_prefix(DEPOSIT_MEMO_PREFIX)?;
    (id.len() == DEPOSIT_ID_HEX
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
    .then(|| id.to_string())
}

/// Every received output in the wallet whose memo names a deposit id.
pub fn scan(wallet: &Wallet) -> Result<Vec<DepositOutput>> {
    Ok(ingest::outputs(wallet)?
        .into_iter()
        .filter_map(|o| {
            let id = deposit_id(o.memo.as_deref()?)?;
            Some(DepositOutput {
                txid: o.txid,
                pool: o.pool,
                output_index: o.output_index,
                deposit_id: id,
                amount_zat: o.value,
                height: o.height,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exact_deposit_memos() {
        let id = "0123456789abcdef0123456789abcdef";
        assert_eq!(deposit_id(&format!("kakure:d1;{id}")).as_deref(), Some(id));
        assert_eq!(
            deposit_id(&format!("kakure:d1;{id}\nReply to:\nutest1…")).as_deref(),
            Some(id),
            "Zingo's reply-to tail is ignored"
        );
        assert!(deposit_id(&format!("kakure:d1;{}", id.to_uppercase())).is_none());
        assert!(deposit_id("kakure:d1;0123").is_none());
        assert!(deposit_id(&format!("kakure:v1;{id}")).is_none());
    }
}
