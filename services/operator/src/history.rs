//! Daily price history, `history-<yyyymmdd>.json` (signed; `historySchema` in `@kakure/domain`).
//!
//! For every close market that ran on a UTC day, its price path from the primary venue
//! (Coinbase): 1-minute closes for hourly markets, 5-minute closes for daily ones. The path is
//! fetched when the market resolves. Each day's file is written once, after the day's markets
//! have resolved, because published files are immutable (the data-worker caches them forever);
//! clients always fetch whole days, never one market (uniform per day, PD14).

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;

use crate::{
    catalog::{self, DAY_SECS, HOUR_SECS},
    domain::SCHEMA_VERSION,
    publish::{Publisher, sign_file},
    signing::Keypair,
    store::{MarketRow, Store},
    venues,
};

/// 1-minute closes for hourly markets, 5-minute closes for daily ones.
const HOURLY_INTERVAL: i64 = 60;
const DAILY_INTERVAL: i64 = 300;
/// A day is published once all its markets resolved, or this long after it ended regardless.
const DAY_GRACE_SECS: i64 = 6 * HOUR_SECS;
/// The bundle lists this many recent days.
pub const LISTED_DAYS: i64 = 7;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMarket {
    pub id: String,
    pub subject: String,
    pub window: String,
    pub venue: String,
    pub pair: String,
    pub interval: i64,
    /// `[unixSeconds, "price"]`, oldest first.
    pub closes: Vec<(i64, String)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDoc {
    pub v: u32,
    pub network: String,
    /// `YYYY-MM-DD` (UTC).
    pub day: String,
    pub markets: Vec<HistoryMarket>,
}

fn day_key(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .expect("timestamp in range")
        .format("%Y%m%d")
        .to_string()
}

/// Fetches and stores a resolved close market's path (retried each tick until it succeeds).
pub async fn fetch_path(
    store: &Store,
    http: &reqwest::Client,
    m: &MarketRow,
    now: i64,
) -> Result<()> {
    let asset = catalog::asset(&m.subject.to_lowercase()).context("unknown asset")?;
    let product = asset.venues[0].pair;
    let interval = if m.closes_at - m.opens_at == HOUR_SECS {
        HOURLY_INTERVAL
    } else {
        DAILY_INTERVAL
    };
    let path = venues::coinbase_path(http, product, m.opens_at, m.closes_at, interval).await?;
    let series: Value = path
        .into_iter()
        .map(|(t, p)| serde_json::json!([t, p]))
        .collect();
    store.conn.execute(
        "INSERT OR REPLACE INTO price_paths (market_id, day, interval, series, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![m.id, day_key(m.opens_at), interval, series.to_string(), now],
    )?;
    Ok(())
}

/// Writes every finished day's file that does not exist yet.
pub fn publish_days(
    store: &Store,
    key: &Keypair,
    publisher: &Publisher,
    network: &str,
    markets: &[MarketRow],
    now: i64,
) -> Result<()> {
    let days: Vec<String> = {
        let mut stmt = store.conn.prepare(
            "SELECT DISTINCT day FROM price_paths WHERE day NOT IN (SELECT day FROM history_files) ORDER BY day",
        )?;
        stmt.query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?
    };
    for day in days {
        let day_markets: Vec<&MarketRow> = markets
            .iter()
            .filter(|m| m.kind == "close" && day_key(m.opens_at) == day)
            .collect();
        let Some(day_start) = day_markets
            .iter()
            .map(|m| m.opens_at.div_euclid(DAY_SECS) * DAY_SECS)
            .next()
        else {
            continue;
        };
        let day_end = day_start + DAY_SECS;
        let all_resolved = day_markets.iter().all(|m| m.outcome.is_some());
        if now < day_end || !(all_resolved || now >= day_end + DAY_GRACE_SECS) {
            continue;
        }
        let mut entries = vec![];
        let mut stmt = store.conn.prepare(
            "SELECT market_id, interval, series FROM price_paths WHERE day = ?1 ORDER BY market_id",
        )?;
        let rows = stmt.query_map([&day], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (id, interval, series) = row?;
            let Some(m) = day_markets.iter().find(|m| m.id == id) else {
                continue;
            };
            let asset = catalog::asset(&m.subject.to_lowercase()).context("unknown asset")?;
            let closes: Vec<(i64, String)> = serde_json::from_str(&series)?;
            entries.push(HistoryMarket {
                id,
                subject: m.subject.clone(),
                window: m.window.clone(),
                venue: asset.venues[0].venue.key().to_string(),
                pair: asset.venues[0].pair.to_string(),
                interval,
                closes,
            });
        }
        let doc = HistoryDoc {
            v: SCHEMA_VERSION,
            network: network.to_string(),
            day: format!("{}-{}-{}", &day[..4], &day[4..6], &day[6..]),
            markets: entries,
        };
        let file = sign_file(key, &serde_json::to_value(&doc)?)?;
        let name = format!("history-{day}.json");
        publisher.write(&name, &file.bytes, true)?;
        store.conn.execute(
            "INSERT INTO history_files (day, file, created_at) VALUES (?1, ?2, ?3)",
            params![day, name, now],
        )?;
        eprintln!(
            "history: {name} ({} markets, {} bytes)",
            doc.markets.len(),
            file.bytes.len()
        );
    }
    Ok(())
}

/// The recent day files, oldest first, for the bundle's `history` list.
pub fn recent_files(store: &Store, now: i64) -> Result<Vec<String>> {
    let since = day_key(now - LISTED_DAYS * DAY_SECS);
    let mut stmt = store
        .conn
        .prepare("SELECT file FROM history_files WHERE day > ?1 ORDER BY day")?;
    let rows = stmt.query_map([since], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}
