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

/// One raw venue response, archived as resolution evidence (plan §13.5).
#[derive(Clone, Debug)]
pub struct Fetched {
    pub url: String,
    pub fetched_at: i64,
    pub status: u16,
    pub body: String,
}

/// The 1-hour candle starting at `start` on `pair`, read at wall time `now`.
pub async fn candle(
    http: &reqwest::Client,
    pair: &VenuePair,
    start: i64,
    now: i64,
) -> Result<Candle> {
    candle_raw(http, pair, start, now).await.map(|(c, _)| c)
}

/// As `candle`, also returning the raw response (`None` when nothing was fetched yet).
pub async fn candle_raw(
    http: &reqwest::Client,
    pair: &VenuePair,
    start: i64,
    now: i64,
) -> Result<(Candle, Option<Fetched>)> {
    if now < start + HOUR_SECS {
        return Ok((Candle::NotYet, None));
    }
    let p = pair.pair;
    let url = match pair.venue {
        Venue::Coinbase => format!(
            "https://api.exchange.coinbase.com/products/{p}/candles?granularity=3600&start={start}&end={}",
            start + HOUR_SECS
        ),
        Venue::Kraken => format!(
            "https://api.kraken.com/0/public/OHLC?pair={p}&interval=60&since={}",
            start - HOUR_SECS
        ),
        Venue::Bitstamp => format!(
            "https://www.bitstamp.net/api/v2/ohlc/{p}/?step=3600&limit=2&start={start}&exclude_current_candle=true"
        ),
        Venue::Gemini => format!("https://api.gemini.com/v2/candles/{p}/1hr"),
    };
    let (body, fetched) = get_json(http, &url).await?;
    let candle = parse_candle(pair.venue, &body, start)?;
    Ok((candle, Some(fetched)))
}

fn parse_candle(venue: Venue, body: &Value, start: i64) -> Result<Candle> {
    match venue {
        // [time, low, high, open, close, volume], newest first.
        Venue::Coinbase => pick(rows_of(body)?, start, 0, 4, 5),
        Venue::Kraken => {
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
            // [time_ms, open, high, low, close, volume], newest first; completed candles only.
            for row in rows_of(body)? {
                if number(&row[0])? == (start * 1_000) as f64 {
                    return candle_from(&row[4], &row[5]);
                }
            }
            Ok(Candle::NotYet)
        }
    }
}

/// Coinbase closes on `[start, end)` at `granularity` seconds (60 or 300; at most 300 rows),
/// oldest first, as `(candle start, close)`. Minutes without trades have no candle.
pub async fn coinbase_path(
    http: &reqwest::Client,
    product: &str,
    start: i64,
    end: i64,
    granularity: i64,
) -> Result<Vec<(i64, String)>> {
    let url = format!(
        "https://api.exchange.coinbase.com/products/{product}/candles?granularity={granularity}&start={start}&end={}",
        end - granularity
    );
    let (body, _) = get_json(http, &url).await?;
    let mut path = vec![];
    for row in rows_of(&body)? {
        let time = number(&row[0])? as i64;
        if (start..end).contains(&time) {
            let close = match &row[4] {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                other => bail!("bad close {other}"),
            };
            path.push((time, close));
        }
    }
    path.sort_by_key(|(t, _)| *t);
    Ok(path)
}

pub(crate) async fn get_json(http: &reqwest::Client, url: &str) -> Result<(Value, Fetched)> {
    let response = http
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    let status = response.status();
    let fetched_at = chrono::Utc::now().timestamp();
    let body = response.text().await?;
    ensure!(status.is_success(), "GET {url}: HTTP {status}");
    let value = serde_json::from_str(&body).with_context(|| format!("GET {url}: not JSON"))?;
    Ok((
        value,
        Fetched {
            url: url.to_string(),
            fetched_at,
            status: status.as_u16(),
            body,
        },
    ))
}
pub(crate) fn rows_of(value: &Value) -> Result<&Vec<Value>> {
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

pub(crate) fn candle_from(close: &Value, volume: &Value) -> Result<Candle> {
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
pub(crate) fn number(value: &Value) -> Result<f64> {
    match value {
        Value::Number(n) => n.as_f64().ok_or_else(|| anyhow!("bad number {n}")),
        Value::String(s) => s.parse().with_context(|| format!("bad number {s:?}")),
        other => bail!("expected a number, got {other}"),
    }
}
