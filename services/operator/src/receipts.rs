//! Blind receipts for the Bets board (plan §0 R7 under v2, after its privacy reviews).
//!
//! Publishing a call must not let anyone, Kakure included, join the published receipt to the trade or the trade to a
//! nickname. So the owner sends, over Oblivious HTTP, the position's id and secret and a *blinded* point `B_ = Y + rG`
//! of a random receipt secret only the device knows. The operator checks its own book (a single Up or Down call; its
//! Window decided Up or Down; at least `RECEIPT_MIN_TRADES` singles opened on that Window), marks the position
//! vouched (once), and blind-signs `B_` with its "right" or its "wrong" receipt key, with a NUT-12 DLEQ proof. The
//! device unblinds it into a token `(secret, C, DLEQ)` that anyone can check against the two published keys
//! (NUT-12's third-party verification), and hands only that to the arcade. The operator never sees the token or the
//! arcade key; the arcade never sees the trade.
//!
//! Positions leave the book two days after they're paid, so a call can be vouched for until then. A retried request
//! (same bytes) gets the cached answer (NUT-19), so a lost answer is never a second vouching.

use cashu::PublicKey;
use serde::Deserialize;
use serde_json::json;

use crate::{
    api::{Answer, Api, KAKURE_BAD_REQUEST, commit_and, internal, refuse},
    positions::{self, Kind},
    rt_store,
    trading::{KAKURE_NOT_SETTLED, owned},
};

/// A Window counts once this many singles were opened on it: the call was one of a crowd of trades.
pub const RECEIPT_MIN_TRADES: i64 = 3;
const KAKURE_NOT_PUBLISHABLE: u32 = 20_018;
const KAKURE_ALREADY_VOUCHED: u32 = 20_019;

#[derive(Deserialize)]
pub struct ReceiptRequest {
    position: String,
    secret: String,
    /// The blinded receipt point, compressed hex.
    blinded: String,
}

pub fn receipt(api: &Api, request: ReceiptRequest, cache: Option<&str>) -> Answer {
    let blinded = PublicKey::from_hex(&request.blinded)
        .map_err(|_| refuse(KAKURE_BAD_REQUEST, "bad blinded point"))?;
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
    let right = match outcome.as_deref() {
        None => return Err(refuse(KAKURE_NOT_SETTLED, "its Window hasn't settled yet")),
        Some("refund") => {
            return Err(refuse(
                KAKURE_NOT_PUBLISHABLE,
                "a refunded Window decides nothing",
            ));
        }
        Some(_) if trades < RECEIPT_MIN_TRADES => {
            return Err(refuse(
                KAKURE_NOT_PUBLISHABLE,
                format!(
                    "its Window had fewer than {RECEIPT_MIN_TRADES} trades, so publishing it would single it out"
                ),
            ));
        }
        Some(outcome) => side == outcome,
    };
    let signature = api.mint.sign_receipt(right, &blinded).map_err(internal)?;
    let answer = json!({ "right": right, "signature": signature });
    commit_and(api, cache.map(|key| (key, &answer)), |tx, now| {
        if positions::vouch(tx, &position.id, now).map_err(internal)? {
            Ok(())
        } else {
            Err(refuse(
                KAKURE_ALREADY_VOUCHED,
                "this call already has its receipt",
            ))
        }
    })?;
    Ok(answer)
}
