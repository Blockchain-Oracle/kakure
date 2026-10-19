//! Real-time lanes (plan §00 REVAMP 2): Windows back to back per (asset, cadence, phase).
//!
//! Rust mirror of `packages/domain/src/lanes.ts` (the reference); `fixtures/lanes.json` keeps the
//! two identical. A Window is derived from its lane and its start, so only the lane rules are
//! published ahead; every boundary is a whole minute, so every print is a 1-minute venue candle.

use crate::venues::{Venue, VenuePair};

/// Window lengths, shortest first: 1m, 2m, 5m, 15m, 1h, 4h, 1d.
pub const CADENCES_SECS: [i64; 7] = [60, 120, 300, 900, 3_600, 14_400, 86_400];
/// Entry and early close stop this long before expiry.
pub const ENTRY_BUFFER_SECS: i64 = 30;
const MINUTE: i64 = 60;
const HOUR: i64 = 3_600;
const DAY: i64 = 86_400;

/// Two series half a Window apart on the short lanes (Owarine's staggered phases).
pub fn phases(cadence: i64) -> &'static [i64] {
    match cadence {
        120 => &[0, 60],
        300 => &[0, 180],
        _ => &[0],
    }
}

/// One 24/7 asset: its ticker and the three venues that print and vote for it, in vote order.
/// ZEC uses Gemini instead of Bitstamp, whose ZEC book is thin (zcash-stack-and-feeds §5.2–5.3).
pub struct LaneAsset {
    pub ticker: &'static str,
    pub venues: [VenuePair; 3],
}

const fn three(coinbase: &'static str, kraken: &'static str, third: VenuePair) -> [VenuePair; 3] {
    [
        VenuePair {
            venue: Venue::Coinbase,
            pair: coinbase,
        },
        VenuePair {
            venue: Venue::Kraken,
            pair: kraken,
        },
        third,
    ]
}

const fn bitstamp(pair: &'static str) -> VenuePair {
    VenuePair {
        venue: Venue::Bitstamp,
        pair,
    }
}

pub const LANE_ASSETS: [LaneAsset; 6] = [
    LaneAsset {
        ticker: "BTC",
        venues: three("BTC-USD", "XBTUSD", bitstamp("btcusd")),
    },
    LaneAsset {
        ticker: "ETH",
        venues: three("ETH-USD", "ETHUSD", bitstamp("ethusd")),
    },
    LaneAsset {
        ticker: "SOL",
        venues: three("SOL-USD", "SOLUSD", bitstamp("solusd")),
    },
    LaneAsset {
        ticker: "ZEC",
        venues: three(
            "ZEC-USD",
            "ZECUSD",
            VenuePair {
                venue: Venue::Gemini,
                pair: "zecusd",
            },
        ),
    },
    LaneAsset {
        ticker: "XRP",
        venues: three("XRP-USD", "XRPUSD", bitstamp("xrpusd")),
    },
    LaneAsset {
        ticker: "DOGE",
        venues: three("DOGE-USD", "XDGUSD", bitstamp("dogeusd")),
    },
];

pub fn asset(ticker: &str) -> Option<&'static LaneAsset> {
    LANE_ASSETS.iter().find(|a| a.ticker == ticker)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lane {
    /// `btc-1m`, `btc-2m+1` (the series one minute later), `eth-1d`.
    pub id: String,
    pub asset: &'static str,
    pub cadence: i64,
    pub phase: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaneWindow {
    /// `<lane id>-<start unix seconds>`.
    pub id: String,
    pub lane: String,
    pub start: i64,
    pub expiry: i64,
}

/// "1m", "2m", "5m", "15m", "1h", "4h", "1d".
pub fn cadence_label(cadence: i64) -> String {
    if cadence % DAY == 0 {
        format!("{}d", cadence / DAY)
    } else if cadence % HOUR == 0 {
        format!("{}h", cadence / HOUR)
    } else {
        format!("{}m", cadence / MINUTE)
    }
}

pub fn lane_id(ticker: &str, cadence: i64, phase: i64) -> String {
    let base = format!("{}-{}", ticker.to_lowercase(), cadence_label(cadence));
    if phase == 0 {
        base
    } else {
        format!("{base}+{}", phase / MINUTE)
    }
}

/// Every lane, by asset then cadence then phase (the order `LANES` has in TypeScript).
pub fn lanes() -> Vec<Lane> {
    let mut out = Vec::new();
    for asset in &LANE_ASSETS {
        for cadence in CADENCES_SECS {
            for &phase in phases(cadence) {
                out.push(Lane {
                    id: lane_id(asset.ticker, cadence, phase),
                    asset: asset.ticker,
                    cadence,
                    phase,
                });
            }
        }
    }
    out
}

// Trading (stage T3) parses the Window ids it is sent; the shared vectors test both now.
#[allow(dead_code)]
pub fn lane_by_id(id: &str) -> Option<Lane> {
    lanes().into_iter().find(|l| l.id == id)
}

impl Lane {
    /// The start of the Window containing `at` (a start is `phase + k · cadence`).
    pub fn start_at(&self, at: i64) -> i64 {
        self.phase + (at - self.phase).div_euclid(self.cadence) * self.cadence
    }

    pub fn window(&self, start: i64) -> LaneWindow {
        LaneWindow {
            id: format!("{}-{start}", self.id),
            lane: self.id.clone(),
            start,
            expiry: start + self.cadence,
        }
    }

    /// The Window trading at `at`, and the one after it (pre-listed).
    pub fn current_and_next(&self, at: i64) -> (LaneWindow, LaneWindow) {
        let start = self.start_at(at);
        (self.window(start), self.window(start + self.cadence))
    }
}

/// Parses `<lane id>-<start>`; the start must sit on the lane's grid.
#[allow(dead_code)]
pub fn parse_window_id(id: &str) -> Option<(Lane, LaneWindow)> {
    let (lane_part, start) = id.rsplit_once('-')?;
    if start.len() != 10 || !start.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let start: i64 = start.parse().ok()?;
    let lane = lane_by_id(lane_part)?;
    if (start - lane.phase).rem_euclid(lane.cadence) != 0 {
        return None;
    }
    let window = lane.window(start);
    Some((lane, window))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../../packages/domain/fixtures/lanes.json");

    #[test]
    fn matches_the_typescript_lanes() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        let ours = lanes();
        let theirs = v["lanes"].as_array().unwrap();
        assert_eq!(ours.len(), theirs.len());
        for (lane, expected) in ours.iter().zip(theirs) {
            assert_eq!(lane.id, expected["id"].as_str().unwrap());
            assert_eq!(lane.asset, expected["asset"].as_str().unwrap());
            assert_eq!(lane.cadence, expected["cadenceSec"].as_i64().unwrap());
            assert_eq!(lane.phase, expected["phaseSec"].as_i64().unwrap());
        }
        for case in v["windows"].as_array().unwrap() {
            let lane = lane_by_id(case["lane"].as_str().unwrap()).unwrap();
            let at = case["at"].as_i64().unwrap();
            let (now, next) = lane.current_and_next(at);
            assert_eq!(lane.start_at(at), case["start"].as_i64().unwrap());
            assert_eq!(now.id, case["id"].as_str().unwrap());
            assert_eq!(now.expiry, case["expiry"].as_i64().unwrap());
            assert_eq!(next.id, case["next"].as_str().unwrap());
        }
        for case in v["parse"].as_array().unwrap() {
            let id = case["id"].as_str().unwrap();
            assert_eq!(
                parse_window_id(id).is_some(),
                case["valid"].as_bool().unwrap(),
                "{id}"
            );
        }
    }
}
