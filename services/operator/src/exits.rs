//! The exit watcher (plan §00 T3 contract): armed exits fire with nobody's tab open. On every batch
//! of relay prices (and at least once a second) it looks at each armed position:
//! - its Window settled → the mint redeems it on its own (`settled`);
//! - otherwise, while the Window is live, a trail, stop or take-profit that triggers closes it at
//!   the bid (`trail`, `stop`, `takeProfit`).
//!
//! Proceeds are signed onto the blank outputs the client left when it armed the exit, and kept for
//! the client to collect (`POST /v1/position`). Owarine's rules (`terminal/exits/plan.ts`):
//! - trail: on the asset's price, from the best price since arming; it never sells below
//!   break-even less the slippage (a gap through it holds instead);
//! - stop: a price on the losing side; it sells at the bid;
//! - take-profit: a bid level.

use std::{sync::Arc, time::Duration};

use anyhow::{Result, anyhow};
use cashu::BlindedMessage;
use serde_json::Value;

use crate::{
    api::Api,
    fair::{self, BPS_SCALE, Phase},
    lanes,
    positions::{self, Position},
    rt_store, trading,
};

/// At most this often (prices land every 250 ms).
const MIN_SWEEP: Duration = Duration::from_millis(250);
/// At least this often, so a settled Window's armed positions are redeemed without new prices.
const MAX_SWEEP: Duration = Duration::from_secs(1);

pub async fn run(api: Arc<Api>) {
    let mut changes = api.prices.changes();
    loop {
        let _ = tokio::time::timeout(MAX_SWEEP, changes.changed()).await;
        if let Err(e) = sweep(&api) {
            eprintln!("exits: {e:#}");
        }
        tokio::time::sleep(MIN_SWEEP).await;
    }
}

fn sweep(api: &Api) -> Result<()> {
    let armed = {
        let store = api.store.lock().map_err(|_| anyhow!("store poisoned"))?;
        positions::armed(&store.conn)?
    };
    let now = chrono::Utc::now().timestamp();
    for position in armed {
        if let Err(e) = watch(api, &position, now) {
            eprintln!("exits: position {}: {e:#}", position.id);
        }
    }
    Ok(())
}

fn watch(api: &Api, position: &Position, now: i64) -> Result<()> {
    let (Some(window), Some(side)) = (&position.window, &position.side) else {
        return Ok(());
    };
    if let Some(value) = trading::settled_value(api, position).map_err(|r| anyhow!(r.1))? {
        return pay(api, position, value, "redeemed", "settled", now);
    }
    let row = {
        let store = api.store.lock().map_err(|_| anyhow!("store poisoned"))?;
        rt_store::window(&store.conn, window)?
    };
    let Some(row) = row else { return Ok(()) };
    let phase = fair::window_phase(
        row.start,
        row.expiry,
        row.reference.is_some(),
        row.outcome.is_some(),
        now,
    );
    if phase != Phase::Live {
        return Ok(());
    }
    let asset = lanes::parse_window_id(window)
        .map(|(lane, _)| lane.asset)
        .ok_or_else(|| anyhow!("bad Window id"))?;
    let Ok(spot) = api.prices.spot(asset, now * 1_000) else {
        return Ok(());
    };
    let Ok(quoted) = trading::quote(api, window, side, now) else {
        return Ok(());
    };
    let Some(bid) = quoted.quote.bid_e4 else {
        // Under the least bid nothing can sell; it rides.
        return Ok(());
    };
    let Some(mut exit) = position.exit.clone() else {
        return Ok(());
    };
    let up = side == "U";
    let mut fired = None;

    if let Some(trail) = exit.get_mut("trail") {
        let bps = trail["bps"].as_u64().unwrap_or(0) as f64 / BPS_SCALE as f64;
        let slippage = trail["slippageBps"].as_u64().unwrap_or(0);
        let best = trail["best"].as_f64().unwrap_or(spot);
        let better = if up { spot.max(best) } else { spot.min(best) };
        if (better - best).abs() > f64::EPSILON || trail["best"].is_null() {
            trail["best"] = Value::from(better);
            let store = api.store.lock().map_err(|_| anyhow!("store poisoned"))?;
            positions::set_exit(&store.conn, &position.id, &exit)?;
        }
        let best = exit["trail"]["best"].as_f64().unwrap_or(spot);
        let hit = if up {
            spot <= best * (1.0 - bps)
        } else {
            spot >= best * (1.0 + bps)
        };
        // Never below break-even less the slippage: a gap through it holds.
        let floor = (position.price * (BPS_SCALE - slippage.min(BPS_SCALE))).div_ceil(BPS_SCALE);
        if hit && bid >= floor {
            fired = Some("trail");
        }
    }
    if fired.is_none()
        && let Some(level) = exit["stop"]["price"].as_f64()
        && (if up { spot <= level } else { spot >= level })
    {
        fired = Some("stop");
    }
    if fired.is_none()
        && let Some(level) = exit["takeProfit"]["bidE4"].as_u64()
        && bid >= level
    {
        fired = Some("takeProfit");
    }
    match fired {
        Some(how) => pay(
            api,
            position,
            fair::close_value_zat(position.payout_zat, bid),
            "closed",
            how,
            now,
        ),
        None => Ok(()),
    }
}

/// Signs the proceeds onto the outputs the client left and marks the position paid.
fn pay(api: &Api, position: &Position, value: u64, state: &str, how: &str, now: i64) -> Result<()> {
    let outputs: Vec<BlindedMessage> = position
        .exit_outputs
        .as_deref()
        .map(serde_json::from_str)
        .transpose()?
        .unwrap_or_default();
    let signatures = api.mint.sign_value(&outputs, value)?;
    let signatures = serde_json::to_string(&signatures)?;
    let mut store = api.store.lock().map_err(|_| anyhow!("store poisoned"))?;
    let tx = store.conn.transaction()?;
    positions::finish(&tx, &position.id, state, how, value, Some(&signatures), now)?;
    tx.commit()?;
    Ok(())
}
