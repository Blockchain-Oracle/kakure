//! How a Window settles (plan §00 REVAMP 2, PD20). Rust mirror of `packages/domain/src/settle.ts`
//! (the reference); `fixtures/lanes.json` keeps the two identical.
//!
//! Each venue votes by comparing its closing print with its opening print (Up, Down or Flat; no
//! vote without both). Two of three Up or Down decide; anything else refunds every position at
//! cost. Prices compare as exact decimals ("103.330" equals "103.33"), never as floats. The same
//! rule settled the hourly and daily pool markets (`resolve.rs`), which uses it from here.

use std::cmp::Ordering;

use serde_json::{Map, Value};

use crate::{lanes::LaneAsset, venues};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Vote {
    Up,
    Down,
    Flat,
    None,
}

impl Vote {
    pub fn as_str(self) -> &'static str {
        match self {
            Vote::Up => "U",
            Vote::Down => "D",
            Vote::Flat => "flat",
            Vote::None => "none",
        }
    }
}

/// Compares two positive decimal strings exactly (venues print prices as plain decimals).
pub fn cmp_decimal(a: &str, b: &str) -> Option<Ordering> {
    fn parts(s: &str) -> Option<(String, String)> {
        let (int, frac) = s.split_once('.').unwrap_or((s, ""));
        if int.is_empty() && frac.is_empty()
            || !int.bytes().all(|c| c.is_ascii_digit())
            || !frac.bytes().all(|c| c.is_ascii_digit())
        {
            return None;
        }
        let int = int.trim_start_matches('0').to_string();
        Some((int, frac.trim_end_matches('0').to_string()))
    }
    match (parts(a), parts(b)) {
        (Some((ai, af)), Some((bi, bf))) => Some(
            ai.len()
                .cmp(&bi.len())
                .then_with(|| ai.cmp(&bi))
                .then_with(|| {
                    let width = af.len().max(bf.len());
                    format!("{af:0<width$}").cmp(&format!("{bf:0<width$}"))
                }),
        ),
        // Exponent notation (tiny prices printed by a JSON number): compare as floats.
        _ => a.parse::<f64>().ok()?.partial_cmp(&b.parse::<f64>().ok()?),
    }
}

/// One venue's vote: the closing print against its opening print.
pub fn vote(opening: Option<&str>, close: Option<&str>) -> Vote {
    match (opening, close) {
        (Some(open), Some(close)) => match cmp_decimal(close, open) {
            Some(Ordering::Greater) => Vote::Up,
            Some(Ordering::Less) => Vote::Down,
            Some(Ordering::Equal) => Vote::Flat,
            None => Vote::None,
        },
        _ => Vote::None,
    }
}

/// Two of three decide (`U` or `D`); otherwise `None` (refund).
pub fn majority(votes: &[Vote]) -> Option<&'static str> {
    let ups = votes.iter().filter(|v| **v == Vote::Up).count();
    let downs = votes.iter().filter(|v| **v == Vote::Down).count();
    if ups >= 2 {
        Some("U")
    } else if downs >= 2 {
        Some("D")
    } else {
        None
    }
}

/// One venue's print at a boundary: its key and the close, or `None` when the minute had no trades.
pub type Prints = Vec<(&'static str, Option<String>)>;

fn print_of<'a>(prints: &'a Prints, venue: &str) -> Option<&'a str> {
    prints
        .iter()
        .find(|(v, _)| *v == venue)
        .and_then(|(_, p)| p.as_deref())
}

/// `U`, `D` or `refund`, from the venues in vote order.
pub fn outcome_of(venues: &[&'static str], opening: &Prints, closing: &Prints) -> &'static str {
    let votes: Vec<Vote> = venues
        .iter()
        .map(|v| vote(print_of(opening, v), print_of(closing, v)))
        .collect();
    majority(&votes).unwrap_or("refund")
}

/// The venues an asset's Windows vote with, in vote order.
pub fn venue_keys(asset: &LaneAsset) -> Vec<&'static str> {
    asset.venues.iter().map(|p| p.venue.key()).collect()
}

/// A Window's stored prints (`{venue: price | null}`) back as `Prints`.
pub fn prints_from_json(json: &str) -> Prints {
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

/// One venue's band vote: `Some(true)` when its closing print is inside [lo, hi] (edges inclusive,
/// a missing edge unbounded), `Some(false)` outside, `None` without a print.
pub fn band_vote(close: Option<&str>, lo: Option<&str>, hi: Option<&str>) -> Option<bool> {
    let close = close?;
    let above_lo = match lo {
        Some(lo) => cmp_decimal(close, lo)? != Ordering::Less,
        None => true,
    };
    let below_hi = match hi {
        Some(hi) => cmp_decimal(close, hi)? != Ordering::Greater,
        None => true,
    };
    Some(above_lo && below_hi)
}

/// `in`, `out` or `refund` for a band: two of three venues' closes decide, as for Up/Down.
pub fn band_outcome_of(
    venues: &[&'static str],
    closing: &Prints,
    lo: Option<&str>,
    hi: Option<&str>,
) -> &'static str {
    let votes: Vec<Option<bool>> = venues
        .iter()
        .map(|v| band_vote(print_of(closing, v), lo, hi))
        .collect();
    if votes.iter().filter(|v| **v == Some(true)).count() >= 2 {
        "in"
    } else if votes.iter().filter(|v| **v == Some(false)).count() >= 2 {
        "out"
    } else {
        "refund"
    }
}

/// The line the price formula uses: the median opening print with trades, the lower middle one
/// when there are two (always a price a venue printed). `None` with no print at all.
pub fn reference_of(venues: &[&'static str], opening: &Prints) -> Option<String> {
    let mut prints: Vec<&str> = venues.iter().filter_map(|v| print_of(opening, v)).collect();
    prints.sort_by(|a, b| cmp_decimal(a, b).unwrap_or(Ordering::Equal));
    let middle = prints.len().checked_sub(1)? / 2;
    prints.get(middle).map(|p| (*p).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../../packages/domain/fixtures/lanes.json");
    const VENUES: [&str; 3] = ["coinbase", "kraken", "bitstamp"];

    fn prints(value: &Value) -> Prints {
        VENUES
            .iter()
            .filter_map(|v| value.get(*v).map(|p| (*v, p.as_str().map(str::to_string))))
            .collect()
    }

    #[test]
    fn band_outcomes_match_the_typescript() {
        let fair: Value =
            serde_json::from_str(include_str!("../../../packages/domain/fixtures/fair.json"))
                .unwrap();
        for case in fair["bandVotes"].as_array().unwrap() {
            let outcome = band_outcome_of(
                &VENUES,
                &prints(&case["closing"]),
                case["lo"].as_str(),
                case["hi"].as_str(),
            );
            assert_eq!(outcome, case["outcome"].as_str().unwrap(), "{case}");
        }
    }

    #[test]
    fn matches_the_typescript_settlement() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        for case in v["compare"].as_array().unwrap() {
            let order = cmp_decimal(case["a"].as_str().unwrap(), case["b"].as_str().unwrap());
            let expected = match case["order"].as_i64().unwrap() {
                -1 => Ordering::Less,
                0 => Ordering::Equal,
                _ => Ordering::Greater,
            };
            assert_eq!(order, Some(expected), "{case}");
        }
        for case in v["settle"].as_array().unwrap() {
            let opening = prints(&case["opening"]);
            let closing = prints(&case["closing"]);
            assert_eq!(
                outcome_of(&VENUES, &opening, &closing),
                case["outcome"].as_str().unwrap(),
                "{case}"
            );
            assert_eq!(
                reference_of(&VENUES, &opening).as_deref(),
                case["reference"].as_str(),
                "{case}"
            );
        }
    }
}
