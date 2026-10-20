//! The operator's live prices (plan §00 T3 contract): the same price relay stream every chart
//! draws (`/v1/stream`, a snapshot then batched ticks every 250 ms), so the house quotes on the
//! numbers people see. Every client receives every symbol, the operator included.
//!
//! A quote needs a fresh price: the operator refuses when its stream has been silent for more than
//! `MAX_SILENCE` or the asset's last tick is older than `MAX_PRICE_AGE` (venue time). The stream
//! reconnects on its own with a capped backoff; every change bumps a counter the exit watcher
//! waits on.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use futures_util::StreamExt as _;
use serde::Deserialize;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;

pub const DEFAULT_STREAM_URL: &str = "wss://kakure-prices.kakure-price-relay.workers.dev/v1/stream";
/// Mirrors `QUOTE_MAX_SILENCE_MS` and `QUOTE_MAX_PRICE_AGE_MS` in `@kakure/domain`.
pub const MAX_SILENCE: Duration = Duration::from_secs(3);
pub const MAX_PRICE_AGE_MS: i64 = 30_000;
const RECONNECT_MIN: Duration = Duration::from_secs(1);
const RECONNECT_MAX: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub struct Tick {
    pub price: f64,
    /// The venue's timestamp, unix ms.
    pub ts_ms: i64,
}

#[derive(Default)]
struct State {
    ticks: HashMap<String, Tick>,
    last_message: Option<Instant>,
}

/// Why there is no price to quote on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoPrice {
    /// The stream hasn't spoken for over `MAX_SILENCE` (or never has).
    Silent,
    /// The asset has no tick, or only an old one.
    Stale,
}

#[derive(Clone)]
pub struct Prices {
    state: Arc<Mutex<State>>,
    changed: watch::Receiver<u64>,
}

#[derive(Deserialize)]
struct Wire {
    t: String,
    #[serde(default)]
    prices: HashMap<String, WireQuote>,
}

#[derive(Deserialize)]
struct WireQuote {
    p: String,
    ts: i64,
}

impl Prices {
    /// Connects to `KAKURE_PRICE_STREAM` (default: the relay) and keeps the connection up.
    pub fn spawn() -> Self {
        let url =
            std::env::var("KAKURE_PRICE_STREAM").unwrap_or_else(|_| DEFAULT_STREAM_URL.into());
        let state = Arc::new(Mutex::new(State::default()));
        let (bump, changed) = watch::channel(0u64);
        let task_state = state.clone();
        tokio::spawn(async move {
            let mut backoff = RECONNECT_MIN;
            loop {
                match follow(&url, &task_state, &bump).await {
                    Ok(()) => backoff = RECONNECT_MIN,
                    Err(e) => eprintln!("prices: stream lost: {e:#}"),
                }
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(RECONNECT_MAX);
            }
        });
        Self { state, changed }
    }

    /// The asset's latest price (`BTC` reads the `BTC-USD` stream), if it's fresh enough to quote.
    pub fn spot(&self, asset: &str, now_ms: i64) -> Result<f64, NoPrice> {
        let state = self.state.lock().map_err(|_| NoPrice::Silent)?;
        if state
            .last_message
            .is_none_or(|at| at.elapsed() > MAX_SILENCE)
        {
            return Err(NoPrice::Silent);
        }
        match state.ticks.get(&format!("{asset}-USD")) {
            Some(tick) if now_ms - tick.ts_ms <= MAX_PRICE_AGE_MS => Ok(tick.price),
            _ => Err(NoPrice::Stale),
        }
    }

    /// Wakes whenever a batch of prices lands.
    pub fn changes(&self) -> watch::Receiver<u64> {
        self.changed.clone()
    }
}

/// Reads one connection until it ends. `Ok` after a clean close (reconnect at once).
async fn follow(url: &str, state: &Mutex<State>, bump: &watch::Sender<u64>) -> anyhow::Result<()> {
    let (mut socket, _) = tokio_tungstenite::connect_async(url).await?;
    eprintln!("prices: following {url}");
    loop {
        // A silent socket is a dead one: the relay sends every 250 ms while any price moves.
        let next = tokio::time::timeout(MAX_SILENCE * 10, socket.next()).await;
        let message = match next {
            Err(_) => anyhow::bail!("no message for {}s", (MAX_SILENCE * 10).as_secs()),
            Ok(None) => return Ok(()),
            Ok(Some(message)) => message?,
        };
        let text = match message {
            Message::Text(text) => text,
            Message::Close(_) => return Ok(()),
            _ => continue,
        };
        let Ok(wire) = serde_json::from_str::<Wire>(&text) else {
            continue;
        };
        {
            let mut state = state
                .lock()
                .map_err(|_| anyhow::anyhow!("price state poisoned"))?;
            state.last_message = Some(Instant::now());
            if wire.t == "snap" || wire.t == "ticks" {
                for (symbol, quote) in wire.prices {
                    if let Ok(price) = quote.p.parse::<f64>()
                        && price > 0.0
                    {
                        state.ticks.insert(
                            symbol,
                            Tick {
                                price,
                                ts_ms: quote.ts,
                            },
                        );
                    }
                }
            }
        }
        bump.send_modify(|n| *n = n.wrapping_add(1));
    }
}
