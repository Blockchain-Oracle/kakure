//! Receipts for the Bets board (plan §0 R7 under v2, after the R7 privacy review).
//!
//! Publishing a call must never put the trade beside an IP. So the owner asks the operator, over Oblivious HTTP,
//! with the position's secret and the arcade key it publishes under; the operator checks its own book (a single Up
//! or Down call, its Window decided Up or Down, at least `RECEIPT_MIN_TRADES` singles opened on that Window) and signs
//! only `{type, network, receipt, right, player}`. The receipt id is a hash of the position's lock, the same for every
//! certificate the position was issued; the device carries the token to the arcade, which learns the call was right
//! or wrong for that key and nothing about the trade. Positions leave the book two days after they're paid, so a call
//! can be vouched for until then.

use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    api::{Answer, Api, internal, refuse},
    positions::Kind,
    rt_store,
    trading::{KAKURE_NOT_SETTLED, is_hex, owned},
};

/// A Window counts once this many singles were opened on it: the call was one of a crowd of trades.
pub const RECEIPT_MIN_TRADES: i64 = 3;
/// An arcade key: an Ed25519 public key, hex.
const PLAYER_HEX: usize = 64;
const KAKURE_NOT_PUBLISHABLE: u32 = 20_018;

#[derive(Deserialize)]
pub struct ReceiptRequest {
    position: String,
    secret: String,
    player: String,
}

/// The receipt id of a lock: `SHA-256("kakure-receipt:" ‖ lock)`, hex (mirrored in `packages/arcade` `receiptId`).
pub fn receipt_id(lock: &str) -> String {
    hex::encode(Sha256::digest(format!("kakure-receipt:{lock}").as_bytes()))
}

pub fn receipt(api: &Api, request: ReceiptRequest) -> Answer {
    if !is_hex(&request.player, PLAYER_HEX) {
        return Err(refuse(crate::api::KAKURE_BAD_REQUEST, "bad arcade key"));
    }
    let position = owned(api, &request.position, &request.secret)?;
    let side = position.side.as_deref().unwrap_or_default();
    let window_id = position.window.clone().unwrap_or_default();
    if !matches!(position.kind, Kind::Single) || !matches!(side, "U" | "D") {
        return Err(refuse(
            KAKURE_NOT_PUBLISHABLE,
            "only a single Up or Down call can be published",
        ));
    }
    let window = {
        let store = api.store.lock().map_err(internal)?;
        rt_store::window(&store.conn, &window_id).map_err(internal)?
    };
    let outcome = window.as_ref().and_then(|w| w.outcome.clone());
    let trades = window.as_ref().map_or(0, |w| w.trades);
    match outcome.as_deref() {
        None => Err(refuse(KAKURE_NOT_SETTLED, "its Window hasn't settled yet")),
        Some("refund") => Err(refuse(
            KAKURE_NOT_PUBLISHABLE,
            "a refunded Window decides nothing",
        )),
        Some(_) if trades < RECEIPT_MIN_TRADES => Err(refuse(
            KAKURE_NOT_PUBLISHABLE,
            format!(
                "its Window had fewer than {RECEIPT_MIN_TRADES} trades, so publishing it would single it out"
            ),
        )),
        Some(outcome) => {
            let token = json!({
                "v": 1,
                "type": "kakure-receipt",
                "network": api.network_name,
                "receipt": receipt_id(&position.lock),
                "right": side == outcome,
                "player": request.player,
            });
            api.key.sign(&token).map_err(internal)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::receipt_id;

    #[test]
    fn receipt_ids_match_the_arcade_rule() {
        // packages/arcade receiptId("lock-1"), the same bytes hashed.
        assert_eq!(
            receipt_id("lock-1"),
            hex::encode(<sha2::Sha256 as sha2::Digest>::digest(
                b"kakure-receipt:lock-1"
            ))
        );
        assert_ne!(receipt_id("lock-1"), receipt_id("lock-2"));
    }
}
