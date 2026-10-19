//! σ for the price formula (plan §00 REVAMP 2): each lane asset's annualised realised volatility
//! from the price relay's last 5 hours of 1-minute closes (`/v1/bars`, the same history every
//! visitor's chart draws), clamped to `[SIGMA_MIN, SIGMA_MAX]` and published with 4 decimals in
//! every bundle, so anyone can recompute a quote. Mirrors `@kakure/domain` constants.

use std::collections::BTreeMap;

use anyhow::{Result, anyhow};
use serde_json::Value;

use crate::lanes::LANE_ASSETS;

pub const SIGMA_MINUTES_PER_YEAR: f64 = 525_600.0;
pub const SIGMA_MIN: f64 = 0.2;
pub const SIGMA_MAX: f64 = 2.5;
/// Fewer 1-minute returns than this and σ isn't re-estimated (the last value stands).
pub const SIGMA_MIN_RETURNS: usize = 60;
pub const SIGMA_DECIMALS: usize = 4;
/// The relay's public bars (PD19: every symbol in one response).
pub const BARS_URL: &str = "https://kakure-prices.kakure-price-relay.workers.dev/v1/bars";

/// σ per ticker, as published (4-decimal strings), for every asset with enough history.
pub async fn estimate(http: &reqwest::Client) -> Result<BTreeMap<&'static str, String>> {
    let text = http
        .get(BARS_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let body: Value = serde_json::from_str(&text)?;
    let one_minute = body["oneMinute"]
        .as_object()
        .ok_or_else(|| anyhow!("bars: no oneMinute"))?;
    let mut out = BTreeMap::new();
    for asset in &LANE_ASSETS {
        let Some(points) = one_minute
            .get(&format!("{}-USD", asset.ticker))
            .and_then(Value::as_array)
        else {
            continue;
        };
        let closes: Vec<f64> = points
            .iter()
            .filter_map(|p| p.get(1)?.as_str()?.parse::<f64>().ok())
            .filter(|p| *p > 0.0)
            .collect();
        if let Some(sigma) = annualised(&closes) {
            out.insert(asset.ticker, format!("{sigma:.SIGMA_DECIMALS$}"));
        }
    }
    Ok(out)
}

/// Sample standard deviation of 1-minute log returns × √(minutes per year), clamped; `None`
/// with too little history.
pub fn annualised(closes: &[f64]) -> Option<f64> {
    let returns: Vec<f64> = closes.windows(2).map(|w| (w[1] / w[0]).ln()).collect();
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
