//! Trading against the house (plan §00 T3 contract): buy a Window side or a parlay with chips,
//! close at the live bid, redeem once settled, and arm exits the mint fires on its own. Every route
//! runs inside an OHTTP request (`api.rs`); a successful answer is cached (NUT-19), so a resend
//! after a lost answer gets the same certificate or the same signatures.
//!
//! Quotes come from the public formula (`fair.rs`) on the operator's own relay price
//! (`prices.rs`) and the published σ; the client sends the worst price it accepts.

use cashu::BlindedMessage;
use rand::{TryRng as _, rngs::SysRng};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use crate::{
    api::{
        Answer, Api, KAKURE_BAD_REQUEST, KAKURE_TOO_SMALL, NUT_KEYSET_UNKNOWN,
        NUT_TRANSACTION_UNBALANCED, Refusal, commit_and, internal, refuse, spend_and,
    },
    fair::{
        self, CHIP_GRID_ZAT, LegOutcome, LegPrice, PRE_OPEN_PROBABILITY, ParlayRefusal, Phase,
        SideQuote,
    },
    lanes::{self, ENTRY_BUFFER_SECS},
    mint::{self, Proof},
    positions::{self, Kind, Leg, Position},
    prices::NoPrice,
    rt_store,
};

const KAKURE_NOT_TRADING: u32 = 20_010;
const KAKURE_NOT_OFFERED: u32 = 20_011;
const KAKURE_PRICE_MOVED: u32 = 20_012;
const KAKURE_NO_PRICE: u32 = 20_013;
const KAKURE_OVER_CAP: u32 = 20_014;
const KAKURE_UNKNOWN_POSITION: u32 = 20_015;
const KAKURE_PAID: u32 = 20_016;
const KAKURE_NOT_SETTLED: u32 = 20_017;

/// A parlay leg needs this much entry time left (Owarine `LEG_MIN_LEFT_SEC`, rounded up).
const PARLAY_LEG_MIN_LEFT_SECS: i64 = 30;
/// A trail's distance and slippage, in basis points (Owarine `trailBpsOf`: 1..5000).
const MAX_BPS: u64 = 5_000;
const ID_BYTES: usize = 16;
const SECRET_HEX: usize = 64;

/// Published limits (plan §00 T3 contract); testnet is generous, mainnet small.
#[derive(Clone, Copy)]
pub struct Caps {
    pub min_stake: u64,
    pub max_stake: u64,
    pub max_side_payout: u64,
    pub max_parlay_payout: u64,
}

impl Caps {
    pub fn for_network(mainnet: bool) -> Self {
        if mainnet {
            Self {
                min_stake: 100_000,
                max_stake: 5_000_000,
                max_side_payout: 50_000_000,
                max_parlay_payout: 20_000_000,
            }
        } else {
            Self {
                min_stake: 100_000,
                max_stake: 100_000_000,
                max_side_payout: 1_000_000_000,
                max_parlay_payout: 500_000_000,
            }
        }
    }

    pub fn json(&self) -> Value {
        json!({
            "minStakeZat": self.min_stake.to_string(),
            "maxStakeZat": self.max_stake.to_string(),
            "maxSidePayoutZat": self.max_side_payout.to_string(),
            "maxParlayPayoutZat": self.max_parlay_payout.to_string(),
        })
    }
}

/// How many blank outputs a value up to `max` may need: three per decade from the smallest chip.
pub fn blank_count(max: u64) -> usize {
    let mut unit = CHIP_GRID_ZAT;
    let mut count = 0;
    while unit <= max {
        count += 3;
        unit = unit.saturating_mul(10);
    }
    count
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn random_id() -> Result<String, Refusal> {
    let mut bytes = [0u8; ID_BYTES];
    SysRng.try_fill_bytes(&mut bytes).map_err(internal)?;
    Ok(hex::encode(bytes))
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn check_side(side: &str) -> Result<(), Refusal> {
    if side == "U" || side == "D" {
        Ok(())
    } else {
        Err(refuse(KAKURE_BAD_REQUEST, "side is U or D"))
    }
}

/// The position and proof that the caller holds its secret.
fn owned(api: &Api, id: &str, secret: &str) -> Result<Position, Refusal> {
    if !is_hex(secret, SECRET_HEX) {
        return Err(refuse(KAKURE_BAD_REQUEST, "bad secret"));
    }
    let store = api.store.lock().map_err(internal)?;
    let position = positions::get(&store.conn, id)
        .map_err(internal)?
        .ok_or_else(|| refuse(KAKURE_UNKNOWN_POSITION, "no such position"))?;
    let bytes = hex::decode(secret).map_err(|_| refuse(KAKURE_BAD_REQUEST, "bad secret"))?;
    // Same answer for a wrong secret and an unknown id: nothing to learn by guessing.
    if hex::encode(Sha256::digest(&bytes)) != position.lock {
        return Err(refuse(KAKURE_UNKNOWN_POSITION, "no such position"));
    }
    Ok(position)
}

/// A Window's live quote for one side: the phase must be `pre` or `live`.
pub(crate) struct Quoted {
    pub quote: SideQuote,
    pub expiry: i64,
}

pub(crate) fn quote(api: &Api, window: &str, side: &str, now: i64) -> Result<Quoted, Refusal> {
    let (lane, w) = lanes::parse_window_id(window)
        .ok_or_else(|| refuse(KAKURE_BAD_REQUEST, "no such Window"))?;
    let (current, next) = lane.current_and_next(now);
    let store = api.store.lock().map_err(internal)?;
    let row = rt_store::window(&store.conn, window).map_err(internal)?;
    let row = match row {
        Some(row) => row,
        // Listed by the lane rules but not written yet (the minute's work runs at +7 s).
        None if w.id == current.id || w.id == next.id => {
            rt_store::ensure_window(&store.conn, lane.asset, &w).map_err(internal)?;
            rt_store::window(&store.conn, window)
                .map_err(internal)?
                .ok_or_else(|| refuse(KAKURE_NOT_TRADING, "this Window isn't listed"))?
        }
        None => return Err(refuse(KAKURE_NOT_TRADING, "this Window isn't listed yet")),
    };
    drop(store);
    let phase = fair::window_phase(
        row.start,
        row.expiry,
        row.reference.is_some(),
        row.outcome.is_some(),
        now,
    );
    let p_up = match phase {
        Phase::Pre => PRE_OPEN_PROBABILITY,
        Phase::Live => {
            let reference: f64 = row
                .reference
                .as_deref()
                .and_then(|r| r.parse().ok())
                .ok_or_else(|| refuse(KAKURE_NOT_TRADING, "no reference yet"))?;
            let spot = api
                .prices
                .spot(lane.asset, now * 1_000)
                .map_err(|e| match e {
                    NoPrice::Silent => {
                        refuse(KAKURE_NO_PRICE, "the price stream is quiet; try again")
                    }
                    NoPrice::Stale => refuse(KAKURE_NO_PRICE, "this price is stale; try again"),
                })?;
            let sigma: f64 = api
                .sigma
                .lock()
                .map_err(internal)?
                .get(lane.asset)
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| refuse(KAKURE_NO_PRICE, "no σ for this asset yet"))?;
            fair::fair_up(spot, reference, sigma, row.expiry - now)
                .ok_or_else(|| refuse(KAKURE_NO_PRICE, "no price"))?
        }
        Phase::Opening => {
            return Err(refuse(
                KAKURE_NOT_TRADING,
                "this Window is opening; its reference lands in a few seconds",
            ));
        }
        Phase::Riding => {
            return Err(refuse(
                KAKURE_NOT_TRADING,
                "this Window is in its last 30 seconds: positions ride to the close",
            ));
        }
        Phase::Settled => return Err(refuse(KAKURE_NOT_TRADING, "this Window has settled")),
    };
    Ok(Quoted {
        quote: fair::quote_side(fair::side_probability(p_up, side)),
        expiry: row.expiry,
    })
}

/// The stake a request pays: its inputs less the change it asks back. Verifies the inputs.
fn stake_of(
    api: &Api,
    inputs: &[Proof],
    change: &[BlindedMessage],
) -> Result<(Vec<String>, u64), Refusal> {
    let ys = api
        .mint
        .verify(inputs)
        .map_err(|e| refuse(NUT_KEYSET_UNKNOWN, e.to_string()))?;
    let paid = mint::total(inputs.iter().map(|p| p.amount)).map_err(internal)?;
    let back = mint::total(change.iter().map(|o| o.amount)).map_err(internal)?;
    let stake = paid.checked_sub(back).filter(|s| *s > 0).ok_or_else(|| {
        refuse(
            NUT_TRANSACTION_UNBALANCED,
            "the change is more than the inputs",
        )
    })?;
    if stake < api.caps.min_stake || stake > api.caps.max_stake {
        return Err(refuse(
            KAKURE_OVER_CAP,
            format!(
                "stakes run from {} to {} zat",
                api.caps.min_stake, api.caps.max_stake
            ),
        ));
    }
    Ok((ys, stake))
}

fn sign_change(api: &Api, change: &[BlindedMessage]) -> Result<Value, Refusal> {
    if change.is_empty() {
        return Ok(json!([]));
    }
    let signatures = api
        .mint
        .sign(change)
        .map_err(|e| refuse(NUT_KEYSET_UNKNOWN, e.to_string()))?;
    serde_json::to_value(signatures).map_err(internal)
}

fn certificate(api: &Api, position: &Position) -> Result<Value, Refusal> {
    api.key.sign(&position.certificate()).map_err(internal)
}

/* ── Buy ─────────────────────────────────────────────────────────────────────────────────────── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeRequest {
    window: String,
    side: String,
    inputs: Vec<Proof>,
    #[serde(default)]
    change: Vec<BlindedMessage>,
    max_ask_e4: u64,
    lock: String,
}

pub fn trade(api: &Api, request: TradeRequest, cache: Option<&str>) -> Answer {
    check_side(&request.side)?;
    if !is_hex(&request.lock, SECRET_HEX) {
        return Err(refuse(KAKURE_BAD_REQUEST, "bad lock"));
    }
    let now = now();
    let quoted = quote(api, &request.window, &request.side, now)?;
    let ask = quoted.quote.ask_e4.ok_or_else(|| {
        refuse(
            KAKURE_NOT_OFFERED,
            "this side is all but decided: it isn't offered now",
        )
    })?;
    if ask > request.max_ask_e4 {
        return Err(refuse(
            KAKURE_PRICE_MOVED,
            format!("the price moved to {ask}/10000, past your limit"),
        ));
    }
    let (ys, stake) = stake_of(api, &request.inputs, &request.change)?;
    let payout = fair::payout_zat(stake, ask);
    let position = Position {
        id: random_id()?,
        kind: Kind::Single,
        window: Some(request.window.clone()),
        side: Some(request.side.clone()),
        legs: vec![],
        stake_zat: stake,
        price: ask,
        payout_zat: payout,
        lock: request.lock,
        opened_at: now,
        state: "open".into(),
        paid_zat: None,
        how: None,
        exit: None,
        exit_outputs: None,
        exit_signatures: None,
    };
    let answer = json!({
        "position": certificate(api, &position)?,
        "change": sign_change(api, &request.change)?,
    });
    let cap = api.caps.max_side_payout;
    spend_and(api, &ys, cache.map(|k| (k, &answer)), |tx| {
        let open = positions::side_payout(tx, &request.window, &request.side).map_err(internal)?;
        if open + payout > cap {
            return Err(refuse(
                KAKURE_OVER_CAP,
                "this side of the Window is full; try a smaller stake or another Window",
            ));
        }
        positions::insert(tx, &position).map_err(internal)
    })?;
    Ok(answer)
}

#[derive(Deserialize)]
pub struct LegRequest {
    window: String,
    side: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParlayRequest {
    legs: Vec<LegRequest>,
    inputs: Vec<Proof>,
    #[serde(default)]
    change: Vec<BlindedMessage>,
    max_price_e8: u64,
    lock: String,
}

pub fn parlay(api: &Api, request: ParlayRequest, cache: Option<&str>) -> Answer {
    if !is_hex(&request.lock, SECRET_HEX) {
        return Err(refuse(KAKURE_BAD_REQUEST, "bad lock"));
    }
    let now = now();
    let mut legs = Vec::with_capacity(request.legs.len());
    for leg in &request.legs {
        check_side(&leg.side)?;
        if legs.iter().any(|l: &Leg| l.window == leg.window) {
            return Err(refuse(KAKURE_BAD_REQUEST, "two legs name the same Window"));
        }
        let quoted = quote(api, &leg.window, &leg.side, now)?;
        if quoted.expiry - ENTRY_BUFFER_SECS - now < PARLAY_LEG_MIN_LEFT_SECS {
            return Err(refuse(
                KAKURE_NOT_TRADING,
                "a leg closes too soon to join a parlay",
            ));
        }
        let ask = quoted.quote.ask_e4.ok_or_else(|| {
            refuse(
                KAKURE_NOT_OFFERED,
                "a leg is all but decided: it isn't offered now",
            )
        })?;
        legs.push(Leg {
            window: leg.window.clone(),
            side: leg.side.clone(),
            ask_e4: ask,
            expiry: quoted.expiry,
        });
    }
    let prices: Vec<LegPrice> = legs
        .iter()
        .map(|l| LegPrice {
            ask_e4: l.ask_e4,
            expiry: l.expiry,
        })
        .collect();
    let price = fair::parlay_price_e8(&prices).map_err(|e| match e {
        ParlayRefusal::Legs => refuse(KAKURE_BAD_REQUEST, "a parlay holds 2 or 3 legs"),
        ParlayRefusal::LongShot => refuse(KAKURE_NOT_OFFERED, "too long a shot; swap a leg"),
    })?;
    if price > request.max_price_e8 {
        return Err(refuse(
            KAKURE_PRICE_MOVED,
            format!("the price moved to {price}/10^8, past your limit"),
        ));
    }
    let (ys, stake) = stake_of(api, &request.inputs, &request.change)?;
    let payout = fair::parlay_payout_zat(stake, price);
    if payout > api.caps.max_parlay_payout {
        return Err(refuse(
            KAKURE_OVER_CAP,
            "that parlay pays more than the cap; lower the stake",
        ));
    }
    let position = Position {
        id: random_id()?,
        kind: Kind::Parlay,
        window: None,
        side: None,
        legs,
        stake_zat: stake,
        price,
        payout_zat: payout,
        lock: request.lock,
        opened_at: now,
        state: "open".into(),
        paid_zat: None,
        how: None,
        exit: None,
        exit_outputs: None,
        exit_signatures: None,
    };
    let answer = json!({
        "position": certificate(api, &position)?,
        "change": sign_change(api, &request.change)?,
    });
    spend_and(api, &ys, cache.map(|k| (k, &answer)), |tx| {
        positions::insert(tx, &position).map_err(internal)
    })?;
    Ok(answer)
}

/* ── Close, redeem ───────────────────────────────────────────────────────────────────────────── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequest {
    position: String,
    secret: String,
    min_bid_e4: u64,
    outputs: Vec<BlindedMessage>,
}

fn live(position: &Position) -> Result<(), Refusal> {
    if position.is_live() {
        Ok(())
    } else {
        Err(refuse(
            KAKURE_PAID,
            "this position is already paid; ask /v1/position for its proceeds",
        ))
    }
}

pub fn close(api: &Api, request: CloseRequest, cache: Option<&str>) -> Answer {
    let position = owned(api, &request.position, &request.secret)?;
    live(&position)?;
    let (Kind::Single, Some(window), Some(side)) =
        (position.kind, &position.window, &position.side)
    else {
        return Err(refuse(
            KAKURE_BAD_REQUEST,
            "a parlay can't be sold back; it rides",
        ));
    };
    let now = now();
    let bid = quote(api, window, side, now)?.quote.bid_e4.ok_or_else(|| {
        refuse(
            KAKURE_NOT_OFFERED,
            "the bid is under 0.02: this position can't be closed now; it rides",
        )
    })?;
    if bid < request.min_bid_e4 {
        return Err(refuse(
            KAKURE_PRICE_MOVED,
            format!("the bid moved to {bid}/10000, under your limit"),
        ));
    }
    let value = fair::close_value_zat(position.payout_zat, bid);
    let signatures = api
        .mint
        .sign_value(&request.outputs, value)
        .map_err(|e| refuse(KAKURE_BAD_REQUEST, e.to_string()))?;
    let answer = json!({ "valueZat": value.to_string(), "bidE4": bid, "signatures": signatures });
    commit_and(api, cache.map(|k| (k, &answer)), |tx, now| {
        positions::finish(tx, &position.id, "closed", "close", value, None, now)
            .map_err(|e| refuse(KAKURE_PAID, e.to_string()))
    })?;
    Ok(answer)
}

/// What a settled position pays, or `None` while a Window it rides on is still open.
pub(crate) fn settled_value(api: &Api, position: &Position) -> Result<Option<u64>, Refusal> {
    let store = api.store.lock().map_err(internal)?;
    let outcome = |window: &str| -> Result<Option<String>, Refusal> {
        Ok(rt_store::window(&store.conn, window)
            .map_err(internal)?
            .and_then(|w| w.outcome))
    };
    match position.kind {
        Kind::Single => {
            let (Some(window), Some(side)) = (&position.window, &position.side) else {
                return Err(internal("a single without a Window"));
            };
            Ok(outcome(window)?.map(|o| {
                if &o == side {
                    position.payout_zat
                } else if o == "refund" {
                    position.stake_zat
                } else {
                    0
                }
            }))
        }
        Kind::Parlay => {
            let mut legs = Vec::with_capacity(position.legs.len());
            for leg in &position.legs {
                let Some(o) = outcome(&leg.window)? else {
                    return Ok(None);
                };
                let result = if o == leg.side {
                    LegOutcome::Won
                } else if o == "refund" {
                    LegOutcome::Refund
                } else {
                    LegOutcome::Lost
                };
                legs.push((
                    LegPrice {
                        ask_e4: leg.ask_e4,
                        expiry: leg.expiry,
                    },
                    result,
                ));
            }
            Ok(Some(fair::parlay_settled_zat(position.stake_zat, &legs)))
        }
    }
}

#[derive(Deserialize)]
pub struct RedeemRequest {
    position: String,
    secret: String,
    #[serde(default)]
    outputs: Vec<BlindedMessage>,
}

pub fn redeem(api: &Api, request: RedeemRequest, cache: Option<&str>) -> Answer {
    let position = owned(api, &request.position, &request.secret)?;
    live(&position)?;
    let value = settled_value(api, &position)?
        .ok_or_else(|| refuse(KAKURE_NOT_SETTLED, "not settled yet"))?;
    let signatures = api
        .mint
        .sign_value(&request.outputs, value)
        .map_err(|e| refuse(KAKURE_BAD_REQUEST, e.to_string()))?;
    let answer = json!({ "valueZat": value.to_string(), "signatures": signatures });
    commit_and(api, cache.map(|k| (k, &answer)), |tx, now| {
        positions::finish(tx, &position.id, "redeemed", "redeem", value, None, now)
            .map_err(|e| refuse(KAKURE_PAID, e.to_string()))
    })?;
    Ok(answer)
}

/* ── Exits ───────────────────────────────────────────────────────────────────────────────────── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrailRequest {
    bps: u64,
    #[serde(default)]
    slippage_bps: u64,
}

#[derive(Deserialize)]
pub struct StopRequest {
    price: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeProfitRequest {
    bid_e4: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitRequest {
    position: String,
    secret: String,
    #[serde(default)]
    outputs: Vec<BlindedMessage>,
    trail: Option<TrailRequest>,
    stop: Option<StopRequest>,
    take_profit: Option<TakeProfitRequest>,
    #[serde(default)]
    cancel: bool,
}

pub fn exit(api: &Api, request: ExitRequest, cache: Option<&str>) -> Answer {
    let position = owned(api, &request.position, &request.secret)?;
    live(&position)?;
    let (Kind::Single, Some(window), Some(side)) =
        (position.kind, &position.window, &position.side)
    else {
        return Err(refuse(KAKURE_BAD_REQUEST, "exits are for single positions"));
    };
    if request.cancel {
        let answer = json!({ "state": "open" });
        commit_and(api, cache.map(|k| (k, &answer)), |tx, _| {
            positions::disarm(tx, &position.id).map_err(internal)
        })?;
        return Ok(answer);
    }
    if request.trail.is_none() && request.stop.is_none() && request.take_profit.is_none() {
        return Err(refuse(
            KAKURE_BAD_REQUEST,
            "name a trail, a stop or a take-profit",
        ));
    }
    let now = now();
    // Only while it can still trade; this also checks the Window and the price stream.
    quote(api, window, side, now)?;
    let asset = lanes::parse_window_id(window)
        .map(|(lane, _)| lane.asset)
        .ok_or_else(|| refuse(KAKURE_BAD_REQUEST, "no such Window"))?;
    let spot = api.prices.spot(asset, now * 1_000).ok();
    let mut exit = json!({ "armedAt": now });
    if let Some(trail) = &request.trail {
        if trail.bps == 0 || trail.bps > MAX_BPS || trail.slippage_bps > MAX_BPS {
            return Err(refuse(
                KAKURE_BAD_REQUEST,
                "a trail is 1–5000 bps, slippage up to 5000",
            ));
        }
        exit["trail"] =
            json!({ "bps": trail.bps, "slippageBps": trail.slippage_bps, "best": spot });
    }
    if let Some(stop) = &request.stop {
        let losing_side = spot.is_none_or(|s| {
            if side == "U" {
                stop.price < s
            } else {
                stop.price > s
            }
        });
        if stop.price.is_nan() || stop.price <= 0.0 || !losing_side {
            return Err(refuse(
                KAKURE_BAD_REQUEST,
                "a stop sits on the losing side of the price",
            ));
        }
        exit["stop"] = json!({ "price": stop.price });
    }
    if let Some(take) = &request.take_profit {
        if !(fair::MIN_BID_E4..=fair::MAX_ASK_E4).contains(&take.bid_e4) {
            return Err(refuse(
                KAKURE_BAD_REQUEST,
                "a take-profit is a bid from 200 to 9800",
            ));
        }
        exit["takeProfit"] = json!({ "bidE4": take.bid_e4 });
    }
    let needed = blank_count(position.payout_zat.max(position.stake_zat));
    if request.outputs.len() < needed || request.outputs.len() > mint::MAX_ITEMS {
        return Err(refuse(
            KAKURE_TOO_SMALL,
            format!("an exit needs {needed} blank outputs for its proceeds"),
        ));
    }
    if request
        .outputs
        .iter()
        .any(|o| o.keyset_id != api.mint.active_id())
    {
        return Err(refuse(
            NUT_KEYSET_UNKNOWN,
            "outputs must name the active keyset",
        ));
    }
    let outputs = serde_json::to_string(&request.outputs).map_err(internal)?;
    let answer = json!({ "state": "armed", "exit": exit });
    commit_and(api, cache.map(|k| (k, &answer)), |tx, _| {
        positions::arm(tx, &position.id, &exit, &outputs)
            .map_err(|e| refuse(KAKURE_PAID, e.to_string()))
    })?;
    Ok(answer)
}

#[derive(Deserialize)]
pub struct PositionRequest {
    position: String,
    secret: String,
}

/// A position's state, and the signatures of proceeds the mint signed on its own (a fired exit
/// or an armed position redeemed at settlement) for the client to collect.
pub fn position(api: &Api, request: PositionRequest) -> Answer {
    let position = owned(api, &request.position, &request.secret)?;
    let signatures: Value = position
        .exit_signatures
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Value::Array(vec![]));
    Ok(json!({
        "state": position.state,
        "how": position.how,
        "paidZat": position.paid_zat.map(|z| z.to_string()),
        "exit": position.exit,
        "signatures": signatures,
    }))
}
