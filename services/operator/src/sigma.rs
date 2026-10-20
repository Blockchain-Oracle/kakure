//! σ for the price formula (plan §00 T3 contract): each lane asset's annualised realised
//! volatility from the 1-minute closes of its first voting venue (Coinbase) over the last
//! `SIGMA_WINDOW_MINUTES`, as the operator committed them, clamped to `[SIGMA_MIN, SIGMA_MAX]` and
//! published with 4 decimals in every bundle. Those closes are the ones the hourly prints files
//! publish, signed, so anyone can recompute σ, and with it any quote. Mirrors `@kakure/domain`.

use std::collections::BTreeMap;

use anyhow::Result;
use rusqlite::Connection;

use crate::{lanes::LANE_ASSETS, minutes::MINUTE_SECS, rt_store};

pub const SIGMA_MINUTES_PER_YEAR: f64 = 525_600.0;
pub const SIGMA_MIN: f64 = 0.2;
pub const SIGMA_MAX: f64 = 2.5;
/// Fewer 1-minute returns than this and σ isn't estimated (the last value stands).
pub const SIGMA_MIN_RETURNS: usize = 60;
pub const SIGMA_DECIMALS: usize = 4;
/// σ is realised over this many minutes (five hours).
pub const SIGMA_WINDOW_MINUTES: i64 = 300;

/// σ per ticker, as published (4-decimal strings), for every asset with enough history: the
/// returns between consecutive minutes that both traded on the first venue, over the window
/// ending at the last committed minute before `now`.
pub fn from_closes(conn: &Connection, now: i64) -> Result<BTreeMap<&'static str, String>> {
    let to = now.div_euclid(MINUTE_SECS) * MINUTE_SECS;
    let from = to - SIGMA_WINDOW_MINUTES * MINUTE_SECS;
    let mut out = BTreeMap::new();
    for asset in &LANE_ASSETS {
        let venue = asset.venues[0].venue.key();
        let rows = rt_store::minutes_between(conn, asset.ticker, venue, from, to)?;
        let mut returns = Vec::with_capacity(rows.len());
        for pair in rows.windows(2) {
            let ((t0, Some(a)), (t1, Some(b))) = (&pair[0], &pair[1]) else {
                continue;
            };
            if t1 - t0 != MINUTE_SECS {
                continue;
            }
            if let (Ok(a), Ok(b)) = (a.parse::<f64>(), b.parse::<f64>())
                && a > 0.0
                && b > 0.0
            {
                returns.push((b / a).ln());
            }
        }
        if let Some(sigma) = annualised_returns(&returns) {
            out.insert(asset.ticker, format!("{sigma:.SIGMA_DECIMALS$}"));
        }
    }
    Ok(out)
}

/// Annualised σ of a price series (consecutive 1-minute closes); `None` with too little history.
#[cfg(test)]
pub fn annualised(closes: &[f64]) -> Option<f64> {
    let returns: Vec<f64> = closes.windows(2).map(|w| (w[1] / w[0]).ln()).collect();
    annualised_returns(&returns)
}

/// Sample standard deviation of 1-minute log returns × √(minutes per year), clamped; `None`
/// with too little history.
pub fn annualised_returns(returns: &[f64]) -> Option<f64> {
    if returns.len() < SIGMA_MIN_RETURNS {
        return None;
    }
    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / (n - 1.0);
    Some((variance.sqrt() * SIGMA_MINUTES_PER_YEAR.sqrt()).clamp(SIGMA_MIN, SIGMA_MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_history_clamps_to_the_floor_and_short_history_is_none() {
        assert_eq!(annualised(&[100.0; 120]), Some(SIGMA_MIN));
        assert_eq!(annualised(&[100.0; 10]), None);
    }

    #[test]
    fn alternating_moves_annualise() {
        // ±0.1 % every minute: σ_minute ≈ 0.001, so σ_year ≈ 0.001 × √525600 ≈ 0.725.
        let closes: Vec<f64> = (0..301)
            .map(|i| if i % 2 == 0 { 100.0 } else { 100.1 })
            .collect();
        let sigma = annualised(&closes).unwrap();
        assert!((sigma - 0.725).abs() < 0.01, "{sigma}");
    }
}
