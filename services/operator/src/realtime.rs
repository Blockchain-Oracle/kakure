//! The real-time market runtime (plan §00 REVAMP 2, stage T1): `kakure-operator serve`.
//!
//! Every minute, on the clock:
//! 1. read every venue's committed 1-minute closes for every lane asset (`minutes.rs`);
//! 2. advance every Window: its opening prints once the candle ending at its start is committed
//!    (or `OPEN_GRACE_SECS` passed), then its closing prints and outcome once the candle ending at
//!    its expiry is committed (or `CLOSE_GRACE_SECS` passed): two of three venues decide, otherwise
//!    every position is refunded (`settle.rs`);
//! 3. re-estimate σ every `SIGMA_REFRESH_SECS` (`sigma.rs`);
//! 4. write each finished hour's prints file (every venue's minutes and every Window settled);
//! 5. sign and publish the v2 bundle, then push everything new to the data worker.
//!
//! It shares `engine.sqlite` with the pool engine, so the bundle sequence (and `previous` hash
//! chain) carries on across the cut-over and the worker's "latest only moves forward" holds.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result};
use serde_json::{Map, Value, json};

use crate::{
    catalog::iso,
    fair::{HALF_SPREAD, MAX_ASK, MIN_ASK, MIN_TAU_SECS},
    lanes::{self, ENTRY_BUFFER_SECS, LaneAsset},
    minutes::{self, MINUTE_SECS},
    publish::{LATEST_FILE, Publisher, sign_file},
    push::Push,
    rt_store::{self, WindowRow},
    settle::{self, Prints},
    sigma,
    signing::{self, Keypair},
    store::Store,
    venues,
    wallet::Wallet,
};

pub const SCHEMA_VERSION_V2: u32 = 2;
/// The minute's work starts this long after each minute, once venues have committed its candle.
pub const TICK_OFFSET_SECS: i64 = 20;
/// A Window starts trading without a venue that still hasn't committed its opening minute after
/// this long (that venue doesn't vote).
const OPEN_GRACE_SECS: i64 = 3 * MINUTE_SECS;
/// A Window settles without a venue that still hasn't committed its closing minute after this long.
const CLOSE_GRACE_SECS: i64 = 10 * MINUTE_SECS;
const SIGMA_REFRESH_SECS: i64 = 5 * MINUTE_SECS;
/// Settled Windows stay in the bundle this long; the hourly prints files keep them for good.
const BUNDLE_SETTLED_KEEP_SECS: i64 = 10 * MINUTE_SECS;
const HOUR_SECS: i64 = 3_600;
const DAY_SECS: i64 = 86_400;
/// An hour's prints file is written once its last Window can no longer wait for a venue.
const PRINTS_DELAY_SECS: i64 = CLOSE_GRACE_SECS + 2 * MINUTE_SECS;
/// Bundle files older than this leave the local disk once pushed (the data worker prunes too).
const BUNDLE_FILES_KEEP_SECS: i64 = DAY_SECS;

pub struct Realtime {
    pub store: Store,
    key: Keypair,
    http: reqwest::Client,
    publisher: Publisher,
    network: &'static str,
    sigma: BTreeMap<&'static str, String>,
    /// When σ was last estimated; `None` until the first estimate.
    sigma_at: Option<i64>,
    /// What clients need to trade (keyset, gateway key, deposit address and rules), once the
    /// trading side has started; published in every bundle.
    trading: Option<Value>,
}

pub struct TickReport {
    pub seq: u64,
    pub minutes: usize,
    pub opened: usize,
    pub settled: usize,
    pub windows: usize,
    pub prints: usize,
    pub uploaded: Option<usize>,
}

impl Realtime {
    /// Opens the data directory's store and signing key. No chain access yet (deposits are T2).
    pub fn open(wallet: &Wallet) -> Result<Self> {
        let key = signing::load(&wallet.dir)?;
        let store = Store::open(&wallet.dir.join("engine.sqlite"))?;
        let push = Push::from_env()?;
        if let Some(push) = &push {
            eprintln!("serve: pushing to {}", push.describe());
        }
        let publisher = Publisher::new(&wallet.dir, wallet.net.name(), push);
        Ok(Self {
            store,
            key,
            http: venues::client()?,
            publisher,
            network: wallet.net.name(),
            sigma: BTreeMap::new(),
            sigma_at: None,
            trading: None,
        })
    }

    pub fn public_dir(&self) -> std::path::PathBuf {
        self.publisher.dir()
    }

    pub fn set_trading(&mut self, trading: Value) {
        self.trading = Some(trading);
    }

    pub async fn tick(&mut self, now: i64) -> Result<TickReport> {
        let reads = minutes::read_all(&self.http, now).await;
        let minutes = rt_store::put_minutes(&mut self.store.conn, &reads)?;
        let (opened, settled) = self.advance_windows(now)?;
        if self
            .sigma_at
            .is_none_or(|at| now - at >= SIGMA_REFRESH_SECS)
        {
            match sigma::estimate(&self.http).await {
                Ok(sigma) => {
                    // An asset with too little history keeps its last σ.
                    self.sigma.extend(sigma);
                    self.sigma_at = Some(now);
                }
                Err(e) => eprintln!("serve: σ refresh failed, keeping the last values: {e:#}"),
            }
        }
        let prints = self.publish_prints(now)?;
        let (seq, windows) = self.publish_bundle(now)?;
        rt_store::prune(&self.store.conn, now)?;
        let uploaded = match self.publisher.push() {
            None => None,
            Some(_) => match self.publisher.sync_push(&self.http, &self.store, now).await {
                Ok(n) => Some(n),
                Err(e) => {
                    eprintln!("serve: push failed, retrying next minute: {e:#}");
                    Some(0)
                }
            },
        };
        self.prune_bundle_files(now)?;
        Ok(TickReport {
            seq,
            minutes,
            opened,
            settled,
            windows,
            prints,
            uploaded,
        })
    }

    /// Lists every lane's current and next Window, then records openings and settles what can be.
    fn advance_windows(&mut self, now: i64) -> Result<(usize, usize)> {
        let conn = &self.store.conn;
        for lane in lanes::lanes() {
            let (current, next) = lane.current_and_next(now);
            rt_store::ensure_window(conn, lane.asset, &current)?;
            rt_store::ensure_window(conn, lane.asset, &next)?;
        }
        let (mut opened, mut settled) = (0, 0);
        for row in rt_store::unsettled(conn, now)? {
            let Some(asset) = lanes::asset(&row.asset) else {
                continue;
            };
            let keys = venue_keys(asset);
            let mut reference = row.reference.clone();
            if row.opening.is_none() {
                let (prints, complete) = gather(conn, asset, row.start - MINUTE_SECS)?;
                if !complete && now < row.start + OPEN_GRACE_SECS {
                    continue;
                }
                reference = settle::reference_of(&keys, &prints);
                rt_store::set_opening(conn, &row.id, &prints, reference.as_deref())?;
                opened += 1;
            }
            if now < row.expiry {
                continue;
            }
            let (closing, complete) = gather(conn, asset, row.expiry - MINUTE_SECS)?;
            if !complete && now < row.expiry + CLOSE_GRACE_SECS {
                continue;
            }
            let opening = match &row.opening {
                Some(json) => prints_from_json(json),
                None => gather(conn, asset, row.start - MINUTE_SECS)?.0,
            };
            let outcome = if reference.is_none() {
                "refund"
            } else {
                settle::outcome_of(&keys, &opening, &closing)
            };
            rt_store::settle(conn, &row.id, &closing, outcome, now)?;
            settled += 1;
        }
        Ok((opened, settled))
    }

    /// Writes each finished hour's prints file (the last 24 h only; empty hours are skipped).
    fn publish_prints(&mut self, now: i64) -> Result<usize> {
        let newest = (now - PRINTS_DELAY_SECS).div_euclid(HOUR_SECS) * HOUR_SECS - HOUR_SECS;
        let mut written = 0;
        let mut hour = newest - DAY_SECS + HOUR_SECS;
        while hour <= newest {
            if rt_store::prints_file(&self.store.conn, hour)?.is_none()
                && let Some(document) = self.prints_document(hour)?
            {
                let name = format!("prints-{}.json", hour_stamp(hour));
                let signed = sign_file(&self.key, &document)?;
                self.publisher.write(&name, &signed.bytes, true)?;
                rt_store::put_prints_file(&self.store.conn, hour, &name, now)?;
                written += 1;
            }
            hour += HOUR_SECS;
        }
        Ok(written)
    }

    fn prints_document(&self, hour: i64) -> Result<Option<Value>> {
        let conn = &self.store.conn;
        let mut closes = Map::new();
        let mut any = false;
        for asset in &lanes::LANE_ASSETS {
            let mut by_venue = Map::new();
            for pair in &asset.venues {
                let rows = rt_store::minutes_between(
                    conn,
                    asset.ticker,
                    pair.venue.key(),
                    hour,
                    hour + HOUR_SECS,
                )?;
                any |= !rows.is_empty();
                let rows: Vec<Value> = rows
                    .into_iter()
                    .map(|(start, close)| json!([start, close]))
                    .collect();
                by_venue.insert(pair.venue.key().to_string(), Value::Array(rows));
            }
            closes.insert(asset.ticker.to_string(), Value::Object(by_venue));
        }
        let windows: Vec<Value> = rt_store::expiring_between(conn, hour, hour + HOUR_SECS)?
            .iter()
            .filter(|w| w.outcome.is_some())
            .map(window_json)
            .collect();
        if !any && windows.is_empty() {
            return Ok(None);
        }
        Ok(Some(json!({
            "v": SCHEMA_VERSION_V2,
            "network": self.network,
            "hour": iso(hour),
            "closes": closes,
            "windows": windows,
        })))
    }

    fn publish_bundle(&mut self, now: i64) -> Result<(u64, usize)> {
        let conn = &self.store.conn;
        let lanes_json: Vec<Value> = lanes::lanes()
            .iter()
            .map(|lane| {
                let asset = lanes::asset(lane.asset).expect("every lane's asset is listed");
                json!({
                    "id": lane.id,
                    "asset": lane.asset,
                    "cadenceSec": lane.cadence,
                    "phaseSec": lane.phase,
                    "venues": venue_keys(asset),
                })
            })
            .collect();

        let mut seen = HashSet::new();
        let mut windows = Vec::new();
        for lane in lanes::lanes() {
            let (current, next) = lane.current_and_next(now);
            for id in [current.id, next.id] {
                if let Some(row) = rt_store::window(conn, &id)? {
                    seen.insert(row.id.clone());
                    windows.push(window_json(&row));
                }
            }
        }
        for row in rt_store::settled_since(conn, now - BUNDLE_SETTLED_KEEP_SECS)? {
            if seen.insert(row.id.clone()) {
                windows.push(window_json(&row));
            }
        }

        let sigma: Map<String, Value> = self
            .sigma
            .iter()
            .map(|(asset, s)| ((*asset).to_string(), Value::String(s.clone())))
            .collect();
        let previous = self.store.last_bundle()?;
        let seq = previous.as_ref().map_or(0, |(s, _, _)| s + 1);
        let document = json!({
            "v": SCHEMA_VERSION_V2,
            "network": self.network,
            "seq": seq,
            "publishedAt": iso(now),
            "previous": previous.as_ref().map(|(_, _, hash)| hash.clone()),
            "lanes": lanes_json,
            "pricing": {
                "entryBufferSec": ENTRY_BUFFER_SECS,
                "minTauSec": MIN_TAU_SECS,
                "halfSpread": HALF_SPREAD,
                "minAsk": MIN_ASK,
                "maxAsk": MAX_ASK,
                "sigma": sigma,
                "sigmaAt": iso(self.sigma_at.unwrap_or(now)),
            },
            "windows": windows,
            "prints": rt_store::prints_files_since(conn, now - DAY_SECS)?,
        });
        let mut document = document;
        if let Some(trading) = &self.trading {
            document["trading"] = trading.clone();
        }
        let name = format!("bundle-{seq}.json");
        let signed = sign_file(&self.key, &document)?;
        self.publisher.write(&name, &signed.bytes, true)?;
        conn.execute(
            "INSERT INTO bundles (seq, file, hash, published_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![seq, name, signed.hash, now],
        )?;
        let latest = json!({
            "v": SCHEMA_VERSION_V2,
            "network": self.network,
            "seq": seq,
            "bundle": name,
            "bundleHash": signed.hash,
            "publishedAt": iso(now),
        });
        let latest = sign_file(&self.key, &latest)?;
        self.publisher.write(LATEST_FILE, &latest.bytes, false)?;
        Ok((seq, windows.len()))
    }

    /// Removes pushed (or never-pushed, with no push configured) bundle files older than a day.
    fn prune_bundle_files(&self, now: i64) -> Result<()> {
        let mut stmt = self
            .store
            .conn
            .prepare("SELECT file FROM bundles WHERE published_at < ?1")?;
        let old = stmt
            .query_map([now - BUNDLE_FILES_KEEP_SECS], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for file in old {
            let path = self.publisher.dir().join(&file);
            if path.exists() && (self.publisher.push().is_none() || self.store.uploaded(&file)?) {
                std::fs::remove_file(&path)
                    .with_context(|| format!("removing {}", path.display()))?;
            }
        }
        Ok(())
    }
}

fn venue_keys(asset: &LaneAsset) -> Vec<&'static str> {
    asset.venues.iter().map(|p| p.venue.key()).collect()
}

/// Each venue's print for the minute starting at `start`, and whether every venue has committed it.
fn gather(conn: &rusqlite::Connection, asset: &LaneAsset, start: i64) -> Result<(Prints, bool)> {
    let mut prints = Vec::new();
    let mut complete = true;
    for pair in &asset.venues {
        match rt_store::minute(conn, asset.ticker, pair.venue.key(), start)? {
            Some(close) => prints.push((pair.venue.key(), close)),
            None => {
                complete = false;
                prints.push((pair.venue.key(), None));
            }
        }
    }
    Ok((prints, complete))
}

fn prints_from_json(json: &str) -> Prints {
    let map: Map<String, Value> = serde_json::from_str(json).unwrap_or_default();
    [
        venues::Venue::Coinbase,
        venues::Venue::Kraken,
        venues::Venue::Bitstamp,
        venues::Venue::Gemini,
    ]
    .iter()
    .filter_map(|venue| {
        map.get(venue.key())
            .map(|v| (venue.key(), v.as_str().map(str::to_string)))
    })
    .collect()
}

fn window_json(row: &WindowRow) -> Value {
    let mut out = Map::new();
    out.insert("id".into(), Value::String(row.id.clone()));
    out.insert("startsAt".into(), Value::String(iso(row.start)));
    out.insert("expiresAt".into(), Value::String(iso(row.expiry)));
    if let Some(opening) = &row.opening {
        out.insert(
            "opening".into(),
            serde_json::from_str(opening).unwrap_or(Value::Null),
        );
    }
    if let Some(reference) = &row.reference {
        out.insert("reference".into(), Value::String(reference.clone()));
    }
    if let Some(closing) = &row.closing {
        out.insert(
            "closing".into(),
            serde_json::from_str(closing).unwrap_or(Value::Null),
        );
    }
    if let Some(outcome) = &row.outcome {
        out.insert("outcome".into(), Value::String(outcome.clone()));
    }
    if let Some(at) = row.settled_at {
        out.insert("settledAt".into(), Value::String(iso(at)));
    }
    Value::Object(out)
}

/// `2026101914` for the hour starting 2026-10-19 14:00 UTC.
fn hour_stamp(hour: i64) -> String {
    chrono::DateTime::from_timestamp(hour, 0)
        .map(|t| t.format("%Y%m%d%H").to_string())
        .unwrap_or_default()
}
