//! Every venue's committed 1-minute closes for the real-time lanes (plan §00 REVAMP 2).
//!
//! Each minute the operator reads the last `LOOKBACK_SECS` of 1-minute candles from every venue
//! of every lane asset (one request per venue and asset, all at once) and keeps the minutes the
//! venue has committed. A Window's opening print is the close of the candle ending at its start,
//! its closing print the close of the candle ending at its expiry, so every boundary is one row
//! here. Plain HTTPS, never Tor: public prices, read on a fixed clock for every asset alike (as
//! `venues.rs`).
//!
//! What "committed" means per venue:
//! - Coinbase lists only minutes with trades, newest first, and may still be updating the newest;
//!   a minute is final once it is `SETTLE_LAG_SECS` past its end, and a missing minute inside the
//!   final range had no trades.
//! - Kraken's `last` is the newest committed candle; rows after it are still forming.
//! - Bitstamp (`exclude_current_candle`) and Gemini serve completed candles only.

use std::collections::BTreeMap;

use anyhow::{Result, anyhow, bail};
use futures_util::future::join_all;
use serde_json::Value;

use crate::{
    lanes::LANE_ASSETS,
    venues::{self, Candle, Venue, VenuePair},
};

pub const MINUTE_SECS: i64 = 60;
/// How far back each read reaches; any minute a slow venue missed is filled on a later read.
pub const LOOKBACK_SECS: i64 = 15 * MINUTE_SECS;
/// The first read after a start reaches back far enough for σ's whole window (Coinbase serves
/// at most 300 candles a request, so a few minutes short of it).
pub const STARTUP_LOOKBACK_SECS: i64 = 290 * MINUTE_SECS;

/// How far a tick reads back: over the whole gap since the last tick (an outage, a slow
/// redeploy, a sleeping host) plus the usual margin, so a Window that opened inside the gap still
/// finds its opening minute before its grace runs out; the first read after a start, and any gap
/// past it, reach back the start-up lookback.
pub fn lookback_since(last_tick: Option<i64>, now: i64) -> i64 {
    match last_tick {
        None => STARTUP_LOOKBACK_SECS,
        Some(at) => (now - at + LOOKBACK_SECS).clamp(LOOKBACK_SECS, STARTUP_LOOKBACK_SECS),
    }
}
/// Coinbase may still revise a minute for a few seconds after it ends.
const SETTLE_LAG_SECS: i64 = 5;
/// The most candles Bitstamp serves per request.
const BITSTAMP_MAX: i64 = 1_000;

/// One venue's committed minutes for one asset: `start → Close / NoTrades`, and the newest
/// committed start (minutes after it are not known yet).
pub struct VenueMinutes {
    pub asset: &'static str,
    pub venue: Venue,
    pub minutes: BTreeMap<i64, Candle>,
}

/// Reads every lane asset on every venue. A venue that fails is skipped this minute (and logged);
/// its minutes are filled on a later read within `LOOKBACK_SECS`.
pub async fn read_all(http: &reqwest::Client, now: i64, lookback: i64) -> Vec<VenueMinutes> {
    let reads = LANE_ASSETS.iter().flat_map(|asset| {
        asset.venues.iter().map(move |pair| async move {
            (asset.ticker, *pair, read(http, pair, now, lookback).await)
        })
    });
    let mut out = Vec::new();
    for (asset, pair, result) in join_all(reads).await {
        match result {
            Ok(minutes) => out.push(VenueMinutes {
                asset,
                venue: pair.venue,
                minutes,
            }),
            Err(e) => eprintln!("minutes: {} {asset} failed: {e:#}", pair.venue.key()),
        }
    }
    out
}

async fn read(
    http: &reqwest::Client,
    pair: &VenuePair,
    now: i64,
    lookback: i64,
) -> Result<BTreeMap<i64, Candle>> {
    let p = pair.pair;
    let from = now - lookback;
    let limit = (lookback / MINUTE_SECS + 1).min(BITSTAMP_MAX);
    let url = match pair.venue {
        Venue::Coinbase => format!(
            "https://api.exchange.coinbase.com/products/{p}/candles?granularity=60&start={from}&end={now}"
        ),
        Venue::Kraken => {
            format!("https://api.kraken.com/0/public/OHLC?pair={p}&interval=1&since={from}")
        }
        Venue::Bitstamp => format!(
            "https://www.bitstamp.net/api/v2/ohlc/{p}/?step=60&limit={limit}&exclude_current_candle=true"
        ),
        Venue::Gemini => format!("https://api.gemini.com/v2/candles/{p}/1m"),
    };
    let (body, _) = venues::get_json(http, &url).await?;
    parse(pair.venue, &body, from, now)
}

/// Committed minutes in `[from, now)` from one venue response.
pub fn parse(venue: Venue, body: &Value, from: i64, now: i64) -> Result<BTreeMap<i64, Candle>> {
    let mut rows: BTreeMap<i64, Candle> = BTreeMap::new();
    let newest = match venue {
        // [time, low, high, open, close, volume], newest first.
        Venue::Coinbase => {
            for row in venues::rows_of(body)? {
                let start = venues::number(&row[0])? as i64;
                rows.insert(start, venues::candle_from(&row[4], &row[5])?);
            }
            // The newest minute that has fully ended (plus the lag) is final; minutes without a
            // row up to it had no trades.
            let newest =
                (now - SETTLE_LAG_SECS).div_euclid(MINUTE_SECS) * MINUTE_SECS - MINUTE_SECS;
            // Candles start on whole minutes: fill from the first one at or after `from`.
            let mut minute = (from + MINUTE_SECS - 1).div_euclid(MINUTE_SECS) * MINUTE_SECS;
            while minute <= newest {
                rows.entry(minute).or_insert(Candle::NoTrades);
                minute += MINUTE_SECS;
            }
            newest
        }
        Venue::Kraken => {
            if let Some(errors) = body["error"].as_array().filter(|e| !e.is_empty()) {
                bail!("kraken: {errors:?}");
            }
            let result = body["result"]
                .as_object()
                .ok_or_else(|| anyhow!("kraken: no result"))?;
            let last = result
                .get("last")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow!("kraken: no last"))?;
            let pair_rows = result
                .iter()
                .find(|(key, _)| key.as_str() != "last")
                .map(|(_, rows)| rows)
                .ok_or_else(|| anyhow!("kraken: no pair in result"))?;
            // [time, open, high, low, close, vwap, volume, count]
            for row in venues::rows_of(pair_rows)? {
                let start = venues::number(&row[0])? as i64;
                rows.insert(start, venues::candle_from(&row[4], &row[6])?);
            }
            last
        }
        Venue::Bitstamp => {
            let ohlc = body["data"]["ohlc"]
                .as_array()
                .ok_or_else(|| anyhow!("bitstamp: no ohlc"))?;
            let mut newest = i64::MIN;
            for row in ohlc {
                let start = venues::number(&row["timestamp"])? as i64;
                newest = newest.max(start);
                rows.insert(start, venues::candle_from(&row["close"], &row["volume"])?);
            }
            newest
        }
        // [time_ms, open, high, low, close, volume], newest first; completed candles only.
        Venue::Gemini => {
            let mut newest = i64::MIN;
            for row in venues::rows_of(body)? {
                let start = (venues::number(&row[0])? / 1_000.0) as i64;
                newest = newest.max(start);
                rows.insert(start, venues::candle_from(&row[4], &row[5])?);
            }
            newest
        }
    };
    rows.retain(|start, candle| {
        *start >= from && *start <= newest && !matches!(candle, Candle::NotYet)
    });
    Ok(rows)
}

#[cfg(test)]
mod tests {
    #[test]
    fn lookback_covers_a_gap() {
        let now = 1_000_000;
        assert_eq!(super::lookback_since(None, now), super::STARTUP_LOOKBACK_SECS);
        assert_eq!(super::lookback_since(Some(now - 60), now), super::LOOKBACK_SECS + 60);
        // A two-hour outage reads the two hours back, plus the margin.
        assert_eq!(super::lookback_since(Some(now - 7_200), now), 7_200 + super::LOOKBACK_SECS);
        // A gap past the start-up lookback is capped at it.
        assert_eq!(super::lookback_since(Some(now - 86_400), now), super::STARTUP_LOOKBACK_SECS);
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn coinbase_gaps_are_no_trades_and_the_forming_minute_is_not_final() {
        // A whole minute, as every candle start is.
        let from = 1_792_399_980;
        let now = from + 3 * MINUTE_SECS + 10;
        let body = json!([
            [from + 180, 1, 1, 1, "101.5", 0.2],
            [from + 60, 1, 1, 1, "100.25", 1.5],
            [from, 1, 1, 1, "100", 2],
        ]);
        let rows = parse(Venue::Coinbase, &body, from, now).unwrap();
        assert!(matches!(rows.get(&from), Some(Candle::Close(c)) if c == "100"));
        assert!(matches!(rows.get(&(from + 60)), Some(Candle::Close(c)) if c == "100.25"));
        assert!(matches!(rows.get(&(from + 120)), Some(Candle::NoTrades)));
        assert!(
            !rows.contains_key(&(from + 180)),
            "the forming minute is not final"
        );
    }

    #[test]
    fn kraken_stops_at_last() {
        let from = 1_792_399_980;
        let body = json!({"error": [], "result": {"XXBTZUSD": [
            [from, "1", "1", "1", "100.1", "100", "3", 4],
            [from + 60, "1", "1", "1", "100.2", "100", "0", 0],
            [from + 120, "1", "1", "1", "100.3", "100", "1", 2],
        ], "last": from + 60}});
        let rows = parse(Venue::Kraken, &body, from, from + 200).unwrap();
        assert!(matches!(rows.get(&from), Some(Candle::Close(c)) if c == "100.1"));
        assert!(matches!(rows.get(&(from + 60)), Some(Candle::NoTrades)));
        assert!(!rows.contains_key(&(from + 120)));
    }
}
