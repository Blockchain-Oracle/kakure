//! Venue candles for opening references (and, in S03, closes).
//!
//! These are operator-side reads of public prices over plain HTTPS, not over Tor: they carry no
//! user data, happen on a fixed schedule for every market alike, and the venues' anti-abuse
//! layers often block Tor exits. Clients never call venues except on an explicit, labelled
//! "Re-verify" (PD19).
//!
//! Every venue is read on 1-hour candles (`[start, start + 1h)`): the opening reference of a
//! window starting at `t` is the close of the committed candle starting at `t − 1h`.

use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail, ensure};
use serde_json::Value;

use crate::catalog::HOUR_SECS;

const USER_AGENT: &str = concat!("kakure-operator/", env!("CARGO_PKG_VERSION"));
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Venue {
    Coinbase,
    Kraken,
    Bitstamp,
    Gemini,
}

impl Venue {
    /// Key in a market's `opening` record.
    pub fn key(self) -> &'static str {
        match self {
            Venue::Coinbase => "coinbase",
            Venue::Kraken => "kraken",
            Venue::Bitstamp => "bitstamp",
            Venue::Gemini => "gemini",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Venue::Coinbase => "Coinbase Exchange",
            Venue::Kraken => "Kraken",
            Venue::Bitstamp => "Bitstamp",
            Venue::Gemini => "Gemini",
        }
    }

    /// The public endpoint named in a market's rules.
    pub fn source(self, pair: &str) -> String {
        match self {
            Venue::Coinbase => format!(
                "Coinbase Exchange {pair} 1h candles: https://api.exchange.coinbase.com/products/{pair}/candles?granularity=3600"
            ),
            Venue::Kraken => format!(
                "Kraken {pair} 1h OHLC: https://api.kraken.com/0/public/OHLC?pair={pair}&interval=60"
            ),
            Venue::Bitstamp => format!(
                "Bitstamp {pair} 1h OHLC: https://www.bitstamp.net/api/v2/ohlc/{pair}/?step=3600"
            ),
            Venue::Gemini => {
                format!("Gemini {pair} 1h candles: https://api.gemini.com/v2/candles/{pair}/1hr")
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct VenuePair {
    pub venue: Venue,
    pub pair: &'static str,
}

/// One venue's answer for one candle.
#[derive(Debug)]
pub enum Candle {
    /// The committed candle exists with volume: its close, exactly as the venue printed it.
    Close(String),
    /// The venue has no candle with trades for that hour: no vote (plan §3).
    NoTrades,
    /// Not committed yet or not served yet; ask again later.
    NotYet,
}

pub fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .https_only(true)
        .build()?)
}

/// The 1-hour candle starting at `start` on `pair`, read at wall time `now`.
pub async fn candle(
    http: &reqwest::Client,
    pair: &VenuePair,
    start: i64,
    now: i64,
) -> Result<Candle> {
    if now < start + HOUR_SECS {
        return Ok(Candle::NotYet);
    }
    let p = pair.pair;
    match pair.venue {
        Venue::Coinbase => {
            let url = format!(
                "https://api.exchange.coinbase.com/products/{p}/candles?granularity=3600&start={start}&end={}",
                start + HOUR_SECS
            );
            // [time, low, high, open, close, volume], newest first.
            let rows = get_json(http, &url).await?;
            pick(rows_of(&rows)?, start, 0, 4, 5)
        }
        Venue::Kraken => {
            let url = format!(
                "https://api.kraken.com/0/public/OHLC?pair={p}&interval=60&since={}",
                start - HOUR_SECS
            );
            let body = get_json(http, &url).await?;
            if let Some(errors) = body["error"].as_array().filter(|e| !e.is_empty()) {
                bail!("kraken: {errors:?}");
            }
            let result = body["result"]
                .as_object()
                .ok_or_else(|| anyhow!("kraken: no result"))?;
            // `last` is the newest committed candle; the row after it is still forming.
            let last = result
                .get("last")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow!("kraken: no last"))?;
            if start > last {
                return Ok(Candle::NotYet);
            }
            let rows = result
                .iter()
                .find(|(key, _)| key.as_str() != "last")
                .map(|(_, rows)| rows)
                .ok_or_else(|| anyhow!("kraken: no pair in result"))?;
            // [time, open, high, low, close, vwap, volume, count]
            pick(rows_of(rows)?, start, 0, 4, 6)
        }
        Venue::Bitstamp => {
            let url = format!(
                "https://www.bitstamp.net/api/v2/ohlc/{p}/?step=3600&limit=2&start={start}&exclude_current_candle=true"
            );
            let body = get_json(http, &url).await?;
            let rows = body["data"]["ohlc"]
                .as_array()
                .ok_or_else(|| anyhow!("bitstamp: no ohlc"))?;
            for row in rows {
                if number(&row["timestamp"])? == start as f64 {
                    return candle_from(&row["close"], &row["volume"]);
                }
            }
            Ok(Candle::NotYet)
        }
        Venue::Gemini => {
            let url = format!("https://api.gemini.com/v2/candles/{p}/1hr");
            // [time_ms, open, high, low, close, volume], newest first; completed candles only.
            let rows = get_json(http, &url).await?;
            let rows = rows_of(&rows)?;
            for row in rows {
                if number(&row[0])? == (start * 1_000) as f64 {
                    return candle_from(&row[4], &row[5]);
                }
            }
            Ok(Candle::NotYet)
        }
    }
}

async fn get_json(http: &reqwest::Client, url: &str) -> Result<Value> {
    let response = http
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    let status = response.status();
    let body = response.bytes().await?;
    ensure!(status.is_success(), "GET {url}: HTTP {status}");
    serde_json::from_slice(&body).with_context(|| format!("GET {url}: not JSON"))
}

fn rows_of(value: &Value) -> Result<&Vec<Value>> {
    value
        .as_array()
        .ok_or_else(|| anyhow!("expected an array of candles"))
}

fn pick(rows: &[Value], start: i64, time: usize, close: usize, volume: usize) -> Result<Candle> {
    for row in rows {
        if number(&row[time])? == start as f64 {
            return candle_from(&row[close], &row[volume]);
        }
    }
    Ok(Candle::NotYet)
}

fn candle_from(close: &Value, volume: &Value) -> Result<Candle> {
    if number(volume)? <= 0.0 {
        return Ok(Candle::NoTrades);
    }
    let text = match close {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        other => bail!("bad close {other}"),
    };
    ensure!(number(close)? > 0.0, "non-positive close {text}");
    Ok(Candle::Close(text))
}

/// Venues print numbers either as JSON numbers or as decimal strings.
fn number(value: &Value) -> Result<f64> {
    match value {
        Value::Number(n) => n.as_f64().ok_or_else(|| anyhow!("bad number {n}")),
        Value::String(s) => s.parse().with_context(|| format!("bad number {s:?}")),
        other => bail!("expected a number, got {other}"),
    }
}
