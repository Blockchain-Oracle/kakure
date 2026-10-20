//! The trading API (plan §00 REVAMP 2): `GET /ohttp-keys` and `POST /gateway` on the wire, and the
//! mint's routes inside the encrypted requests.
//!
//! Nothing else is reachable from outside: every call is a `message/ohttp-req` the data worker
//! relays to `/gateway`, decrypted by `gateway.rs` and answered here. Nothing records requests,
//! addresses or timing. Routes (Cashu NUT shapes where one exists; errors `{detail, code}`):
//! - `GET  /v1/keys`: the keyset (also in every signed bundle);
//! - `GET  /v1/deposit/<id>`: what a deposit has received, confirmed and can still mint;
//! - `POST /v1/mint/zcash`: blinded chips signed against a confirmed deposit (NUT-04 shape);
//! - `POST /v1/swap`: chips for chips of the same total (NUT-03);
//! - `POST /v1/checkstate`: spent or not, by `Y` (NUT-07);
//! - `POST /v1/melt/zcash`: chips for a shielded withdrawal at a random time (NUT-05 shape);
//! - trading (`trading.rs`): `/v1/trade`, `/v1/parlay`, `/v1/band`, `/v1/close`, `/v1/redeem`, `/v1/exit`,
//!   `/v1/position`.
//!
//! Every spend checks the chips' signatures, then marks them spent and records its effect in one
//! SQLite transaction, so a chip can never be spent twice, even by two requests at once.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU32, Ordering},
};

use anyhow::{Context, Result};
use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use cashu::BlindedMessage;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use crate::{
    deposits::DEPOSIT_ID_HEX,
    domain::{Network, check_payout_address},
    exits,
    gateway::{Gateway, Inner, MAX_MESSAGE_BYTES, Reply},
    mint::{self, Mint, Proof},
    payouts::{self, Window},
    positions,
    prices::Prices,
    realtime::SigmaMap,
    rt_store,
    signing::Keypair,
    store::Store,
    trading::{self, Caps},
};

pub const DEFAULT_ADDR: &str = "127.0.0.1:8790";
/// The smallest withdrawal: the house pays each note's fee, so dust withdrawals are refused.
pub const MIN_WITHDRAW_ZAT: u64 = 1_000_000;
/// Withdrawals go in steps of 0.001 ZEC (each canonical note is its own transaction).
pub const WITHDRAW_GRID_ZAT: u64 = 100_000;
/// Withdrawal notes go out at uniformly random times within this window (plan §00).
pub const WITHDRAW_WINDOW: Window = Window {
    min: 0,
    max: 30 * 60,
};

pub(crate) const NUT_TOKEN_ALREADY_SPENT: u32 = 11_001;
pub(crate) const NUT_TRANSACTION_UNBALANCED: u32 = 11_005;
pub(crate) const NUT_KEYSET_UNKNOWN: u32 = 12_001;
const KAKURE_DEPOSIT_SHORT: u32 = 20_001;
const KAKURE_BAD_ADDRESS: u32 = 20_002;
pub(crate) const KAKURE_TOO_SMALL: u32 = 20_003;
pub(crate) const KAKURE_BAD_REQUEST: u32 = 20_000;

pub struct Api {
    pub gateway: Gateway,
    pub mint: Mint,
    pub store: Mutex<Store>,
    pub tip: Arc<AtomicU32>,
    pub network: Network,
    pub network_name: &'static str,
    pub confirmations: u32,
    /// Trading: the operator's live prices, its signing key (position certificates), the
    /// published σ (shared with the minute loop) and the caps.
    pub prices: Prices,
    pub key: Keypair,
    pub sigma: SigmaMap,
    pub caps: Caps,
}

/// Serves the gateway until the process ends, on `KAKURE_GATEWAY_ADDR` (default `127.0.0.1:8790`),
/// and runs the exit watcher beside it.
pub async fn serve(api: Api) -> Result<()> {
    let api = Arc::new(api);
    tokio::spawn(exits::run(api.clone()));
    let addr = std::env::var("KAKURE_GATEWAY_ADDR").unwrap_or_else(|_| DEFAULT_ADDR.to_string());
    let app = Router::new()
        .route("/ohttp-keys", get(keys))
        .route("/gateway", post(relay))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_MESSAGE_BYTES))
        .with_state(api);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("binding {addr}"))?;
    eprintln!("gateway: listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn keys(State(api): State<Arc<Api>>) -> Response {
    let mut response = api.gateway.key_config().to_vec().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/ohttp-keys"),
    );
    response
}

async fn relay(State(api): State<Arc<Api>>, body: Bytes) -> Response {
    match api.gateway.handle(&body, |inner| route(&api, inner)) {
        Ok(bytes) => {
            let mut response = bytes.into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("message/ohttp-res"),
            );
            response
        }
        // RFC 9458 §5.2: an undecryptable request gets a plain error, never details.
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

/// A failed call: NUT-00's `{detail, code}` with HTTP 400.
pub(crate) struct Refusal(pub(crate) u32, pub(crate) String);

pub(crate) type Answer = std::result::Result<Value, Refusal>;

pub(crate) fn refuse(code: u32, detail: impl Into<String>) -> Refusal {
    Refusal(code, detail.into())
}

/// The NUT-19 cache key of a request: SHA-256 over its method, path and exact body.
fn cache_key(inner: &Inner) -> String {
    let mut hasher = Sha256::new();
    hasher.update(inner.method.as_bytes());
    hasher.update(b" ");
    hasher.update(inner.path.as_bytes());
    hasher.update(b"\n");
    hasher.update(&inner.body);
    hex::encode(hasher.finalize())
}

/// Requests whose success is cached (NUT-19): resending one returns the first answer.
const CACHED: [&str; 9] = [
    "/v1/mint/zcash",
    "/v1/swap",
    "/v1/melt/zcash",
    "/v1/trade",
    "/v1/parlay",
    "/v1/band",
    "/v1/close",
    "/v1/redeem",
    "/v1/exit",
];

fn route(api: &Api, inner: Inner) -> Reply {
    let key = (inner.method == "POST" && CACHED.contains(&inner.path.as_str()))
        .then(|| cache_key(&inner));
    if let Some(key) = &key
        && let Ok(store) = api.store.lock()
        && let Ok(Some(body)) = rt_store::cached_response(&store.conn, key)
    {
        return Reply {
            status: 200,
            body: body.into_bytes(),
        };
    }
    let key = key.as_deref();
    let path = inner.path.as_str();
    let answer = match (inner.method.as_str(), path) {
        ("GET", "/v1/ping") => Ok(json!({ "ok": true, "network": api.network_name })),
        ("GET", "/v1/keys") => Ok(json!({ "keysets": [api.mint.keyset_json()] })),
        ("GET", p) if p.starts_with("/v1/deposit/") => deposit(api, &p["/v1/deposit/".len()..]),
        ("POST", "/v1/mint/zcash") => body(&inner.body).and_then(|r| mint_chips(api, r, key)),
        ("POST", "/v1/swap") => body(&inner.body).and_then(|r| swap(api, r, key)),
        ("POST", "/v1/checkstate") => body(&inner.body).and_then(|r| check_state(api, r)),
        ("POST", "/v1/melt/zcash") => body(&inner.body).and_then(|r| withdraw(api, r, key)),
        ("POST", "/v1/trade") => body(&inner.body).and_then(|r| trading::trade(api, r, key)),
        ("POST", "/v1/parlay") => body(&inner.body).and_then(|r| trading::parlay(api, r, key)),
        ("POST", "/v1/band") => body(&inner.body).and_then(|r| trading::band(api, r, key)),
        ("POST", "/v1/close") => body(&inner.body).and_then(|r| trading::close(api, r, key)),
        ("POST", "/v1/redeem") => body(&inner.body).and_then(|r| trading::redeem(api, r, key)),
        ("POST", "/v1/exit") => body(&inner.body).and_then(|r| trading::exit(api, r, key)),
        ("POST", "/v1/position") => body(&inner.body).and_then(|r| trading::position(api, r)),
        _ => {
            return Reply {
                status: 404,
                body: json!({ "detail": "not found", "code": KAKURE_BAD_REQUEST })
                    .to_string()
                    .into_bytes(),
            };
        }
    };
    match answer {
        Ok(value) => Reply {
            status: 200,
            body: value.to_string().into_bytes(),
        },
        Err(Refusal(code, detail)) => Reply {
            status: 400,
            body: json!({ "detail": detail, "code": code })
                .to_string()
                .into_bytes(),
        },
    }
}

pub(crate) fn body<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> std::result::Result<T, Refusal> {
    serde_json::from_slice(bytes)
        .map_err(|e| refuse(KAKURE_BAD_REQUEST, format!("bad request: {e}")))
}

pub(crate) fn internal(e: impl std::fmt::Display) -> Refusal {
    eprintln!("api: {e}");
    refuse(
        KAKURE_BAD_REQUEST,
        "the mint could not complete this request; nothing was spent",
    )
}

fn valid_deposit_id(id: &str) -> bool {
    id.len() == DEPOSIT_ID_HEX
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn deposit(api: &Api, id: &str) -> Answer {
    if !valid_deposit_id(id) {
        return Err(refuse(KAKURE_BAD_REQUEST, "bad deposit id"));
    }
    let tip = api.tip.load(Ordering::Relaxed);
    let store = api.store.lock().map_err(internal)?;
    let state =
        rt_store::deposit_state(&store.conn, id, tip, api.confirmations).map_err(internal)?;
    let mintable = state.confirmed_zat.saturating_sub(state.issued_zat);
    Ok(json!({
        "state": if state.received_zat == 0 { "unseen" }
            else if state.confirmed_zat < state.received_zat { "confirming" }
            else { "confirmed" },
        "receivedZat": state.received_zat.to_string(),
        "confirmedZat": state.confirmed_zat.to_string(),
        "mintableZat": mintable.to_string(),
        "confirmations": state.first_height.map(|h| tip.saturating_sub(h) + 1).unwrap_or(0),
        "needed": api.confirmations,
    }))
}

#[derive(Deserialize)]
struct MintRequest {
    deposit: String,
    outputs: Vec<BlindedMessage>,
}

fn mint_chips(api: &Api, request: MintRequest, cache: Option<&str>) -> Answer {
    if !valid_deposit_id(&request.deposit) {
        return Err(refuse(KAKURE_BAD_REQUEST, "bad deposit id"));
    }
    let wanted = mint::total(request.outputs.iter().map(|o| o.amount)).map_err(internal)?;
    // Sign first (pure), commit the issuance second: a failed commit hands out nothing.
    let signatures = api
        .mint
        .sign(&request.outputs)
        .map_err(|e| refuse(NUT_KEYSET_UNKNOWN, e.to_string()))?;
    let tip = api.tip.load(Ordering::Relaxed);
    let mut store = api.store.lock().map_err(internal)?;
    let tx = store.conn.transaction().map_err(internal)?;
    let state =
        rt_store::deposit_state(&tx, &request.deposit, tip, api.confirmations).map_err(internal)?;
    let mintable = state.confirmed_zat.saturating_sub(state.issued_zat);
    if wanted > mintable {
        return Err(refuse(
            KAKURE_DEPOSIT_SHORT,
            format!("this deposit can mint {mintable} zat now"),
        ));
    }
    rt_store::add_issued(&tx, &request.deposit, wanted).map_err(internal)?;
    let answer = json!({ "signatures": signatures });
    if let Some(key) = cache {
        rt_store::cache_response(
            &tx,
            key,
            &answer.to_string(),
            chrono::Utc::now().timestamp(),
        )
        .map_err(internal)?;
    }
    tx.commit().map_err(internal)?;
    Ok(answer)
}

#[derive(Deserialize)]
struct SwapRequest {
    inputs: Vec<Proof>,
    outputs: Vec<BlindedMessage>,
}

fn swap(api: &Api, request: SwapRequest, cache: Option<&str>) -> Answer {
    let ys = api
        .mint
        .verify(&request.inputs)
        .map_err(|e| refuse(NUT_KEYSET_UNKNOWN, e.to_string()))?;
    let paid = mint::total(request.inputs.iter().map(|p| p.amount)).map_err(internal)?;
    let wanted = mint::total(request.outputs.iter().map(|o| o.amount)).map_err(internal)?;
    if paid != wanted {
        return Err(refuse(
            NUT_TRANSACTION_UNBALANCED,
            "inputs and outputs differ",
        ));
    }
    let signatures = api
        .mint
        .sign(&request.outputs)
        .map_err(|e| refuse(NUT_KEYSET_UNKNOWN, e.to_string()))?;
    let answer = json!({ "signatures": signatures });
    spend_and(api, &ys, cache.map(|k| (k, &answer)), |_| Ok(()))?;
    Ok(answer)
}

#[derive(Deserialize)]
struct CheckRequest {
    #[serde(rename = "Ys")]
    ys: Vec<String>,
}

fn check_state(api: &Api, request: CheckRequest) -> Answer {
    if request.ys.len() > mint::MAX_ITEMS {
        return Err(refuse(KAKURE_BAD_REQUEST, "too many"));
    }
    let store = api.store.lock().map_err(internal)?;
    let spent = rt_store::spent_states(&store.conn, &request.ys).map_err(internal)?;
    let states: Vec<Value> = request
        .ys
        .iter()
        .zip(spent)
        .map(|(y, s)| json!({ "Y": y, "state": if s { "SPENT" } else { "UNSPENT" }, "witness": null }))
        .collect();
    Ok(json!({ "states": states }))
}

#[derive(Deserialize)]
struct MeltRequest {
    inputs: Vec<Proof>,
    /// A fresh Orchard-only Unified Address of this network.
    address: String,
}

fn withdraw(api: &Api, request: MeltRequest, cache: Option<&str>) -> Answer {
    check_payout_address(&request.address, api.network)
        .map_err(|e| refuse(KAKURE_BAD_ADDRESS, e.to_string()))?;
    let ys = api
        .mint
        .verify(&request.inputs)
        .map_err(|e| refuse(NUT_KEYSET_UNKNOWN, e.to_string()))?;
    let zat = mint::total(request.inputs.iter().map(|p| p.amount)).map_err(internal)?;
    if zat < MIN_WITHDRAW_ZAT {
        return Err(refuse(
            KAKURE_TOO_SMALL,
            format!("withdrawals start at {MIN_WITHDRAW_ZAT} zat"),
        ));
    }
    if zat % WITHDRAW_GRID_ZAT != 0 {
        return Err(refuse(
            KAKURE_BAD_REQUEST,
            format!("withdrawals go in steps of {WITHDRAW_GRID_ZAT} zat"),
        ));
    }
    let now = chrono::Utc::now().timestamp();
    let answer = json!({
        "state": "scheduled",
        "amountZat": zat.to_string(),
        "withinSecs": WITHDRAW_WINDOW.max,
    });
    spend_and(api, &ys, cache.map(|k| (k, &answer)), |tx| {
        // A fresh address every time: two withdrawals to one address are linked for good (privacy re-audit V6). Checked
        // in the spend's transaction, so a refusal costs nothing.
        let used: bool = tx
            .prepare("SELECT 1 FROM payouts WHERE recipient = ?1 LIMIT 1")
            .and_then(|mut stmt| stmt.exists([&request.address]))
            .map_err(internal)?;
        if used {
            return Err(refuse(
                KAKURE_BAD_ADDRESS,
                "this address has been paid before; use a fresh one from your wallet's Receive screen",
            ));
        }
        let id = rt_store::new_withdrawal(tx, zat, now).map_err(internal)?;
        payouts::schedule_withdrawal(tx, id, &request.address, zat, now, WITHDRAW_WINDOW)
            .map_err(internal)?;
        positions::add_to_ledger(tx, "withdrawn", zat).map_err(internal)?;
        Ok(())
    })?;
    Ok(answer)
}

/// Marks the chips spent, runs `effect` and caches the answer (NUT-19), all in one transaction
/// (or none of it).
pub(crate) fn spend_and(
    api: &Api,
    ys: &[String],
    cache: Option<(&str, &Value)>,
    effect: impl FnOnce(&rusqlite::Transaction<'_>) -> std::result::Result<(), Refusal>,
) -> std::result::Result<(), Refusal> {
    commit_and(api, cache, |tx, now| {
        rt_store::spend(tx, ys, now).map_err(|e| refuse(NUT_TOKEN_ALREADY_SPENT, e.to_string()))?;
        effect(tx)
    })
}

/// Runs `effect` and caches the answer (NUT-19) in one transaction: a refusal leaves nothing.
pub(crate) fn commit_and(
    api: &Api,
    cache: Option<(&str, &Value)>,
    effect: impl FnOnce(&rusqlite::Transaction<'_>, i64) -> std::result::Result<(), Refusal>,
) -> std::result::Result<(), Refusal> {
    let now = chrono::Utc::now().timestamp();
    let mut store = api.store.lock().map_err(internal)?;
    let tx = store.conn.transaction().map_err(internal)?;
    effect(&tx, now)?;
    if let Some((key, answer)) = cache {
        rt_store::cache_response(&tx, key, &answer.to_string(), now).map_err(internal)?;
    }
    tx.commit().map_err(internal)?;
    Ok(())
}
