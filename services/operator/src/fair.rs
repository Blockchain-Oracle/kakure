//! The house's public price (plan §00 T3 contract): Mitoshi's fair value
//! `P(Up) = Φ(ln(S/O) / (σ√τ))` (`crypto-world-fair/packages/core/src/fair/agari.ts`) with a
//! published half-spread, on an integer grid of 1/10,000. Rust mirror of
//! `packages/domain/src/fair.ts` (the reference); `fixtures/fair.json` keeps the two identical.
//!
//! A quote outside the bounds is refused, never clamped (Mitoshi `maker/quoting.ts`
//! `pairAround`): a clamped ask on a decided Window would pay a near-certain winner more than it
//! risks. Every input is published (the relay's price, the signed reference, σ), so anyone can
//! recompute any quote.

use crate::lanes::ENTRY_BUFFER_SECS;

/// The fair price never uses less time left than this (Agari/Mitoshi `MIN_SECONDS_LEFT`).
pub const MIN_TAU_SECS: i64 = 5;
/// σ is annual; time left is measured in a 365-day year of seconds.
pub const YEAR_SECS: f64 = 31_536_000.0;
pub const PRICE_SCALE_E4: u64 = 10_000;
pub const HALF_SPREAD_E4: u64 = 250;
pub const MAX_ASK_E4: u64 = 9_800;
pub const MIN_BID_E4: u64 = 200;
pub const PRE_OPEN_PROBABILITY: f64 = 0.5;
/// The smallest chip: payouts and close values are floored to it.
pub const CHIP_GRID_ZAT: u64 = 1_000;
pub const BPS_SCALE: u64 = 10_000;

pub const PARLAY_MIN_LEGS: usize = 2;
pub const PARLAY_MAX_LEGS: usize = 3;
pub const PRICE_SCALE_E8: u64 = 100_000_000;
pub const PARLAY_CORRELATION_FLOOR_BPS: u64 = 5_000;
pub const PARLAY_MIN_PRICE_E8: u64 = 1_000_000;

/// Φ(z), Abramowitz–Stegun 7.1.26, exactly as Agari and Mitoshi.
pub fn normal_cdf(z: f64) -> f64 {
    let x = z.abs() / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.3275911 * x);
    let poly = t
        * (0.254829592
            + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    let erf = 1.0 - poly * (-x * x).exp();
    if z >= 0.0 {
        0.5 * (1.0 + erf)
    } else {
        0.5 * (1.0 - erf)
    }
}

/// P(Up): the chance the closing print ends above the reference. `None` for a non-positive price.
pub fn fair_up(spot: f64, reference: f64, sigma: f64, seconds_left: i64) -> Option<f64> {
    if !(spot > 0.0 && reference > 0.0) {
        return None;
    }
    let scale = sigma * ((seconds_left.max(MIN_TAU_SECS) as f64) / YEAR_SECS).sqrt();
    // NaN as well as zero: no spread of outcomes left.
    if scale.is_nan() || scale <= 0.0 {
        return Some(if spot >= reference { 1.0 } else { 0.0 });
    }
    Some(normal_cdf((spot / reference).ln() / scale))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Pre,
    Opening,
    Live,
    Riding,
    Settled,
}

pub fn window_phase(
    start: i64,
    expiry: i64,
    has_reference: bool,
    settled: bool,
    now: i64,
) -> Phase {
    if settled {
        Phase::Settled
    } else if now < start {
        Phase::Pre
    } else if now >= expiry - ENTRY_BUFFER_SECS {
        Phase::Riding
    } else if has_reference {
        Phase::Live
    } else {
        Phase::Opening
    }
}

/// One side's prices; `None` where the house refuses: the ask to buy, the bid to close.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SideQuote {
    pub ask_e4: Option<u64>,
    pub bid_e4: Option<u64>,
}

/// A side's prices from its probability: half a spread either side, rounded in the house's favour.
pub fn quote_side(probability: f64) -> SideQuote {
    let scaled = probability * PRICE_SCALE_E4 as f64;
    let ask = scaled.ceil() as i64 + HALF_SPREAD_E4 as i64;
    let bid = scaled.floor() as i64 - HALF_SPREAD_E4 as i64;
    SideQuote {
        ask_e4: u64::try_from(ask).ok().filter(|a| *a <= MAX_ASK_E4),
        bid_e4: u64::try_from(bid).ok().filter(|b| *b >= MIN_BID_E4),
    }
}

/// The probability of `side` ("U" or "D") from P(Up).
pub fn side_probability(p_up: f64, side: &str) -> f64 {
    if side == "U" { p_up } else { 1.0 - p_up }
}

fn floor_to_grid(zat: u64) -> u64 {
    zat / CHIP_GRID_ZAT * CHIP_GRID_ZAT
}

/// What a winning position pays: the stake divided by the ask, floored to the smallest chip.
pub fn payout_zat(stake_zat: u64, ask_e4: u64) -> u64 {
    floor_to_grid(stake_zat * PRICE_SCALE_E4 / ask_e4)
}

/// What closing pays now: the payout times the bid, floored to the smallest chip.
pub fn close_value_zat(payout: u64, bid_e4: u64) -> u64 {
    floor_to_grid(payout * bid_e4 / PRICE_SCALE_E4)
}

#[derive(Clone, Copy, Debug)]
pub struct LegPrice {
    pub ask_e4: u64,
    pub expiry: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParlayRefusal {
    Legs,
    LongShot,
}

/// The combined price of a parlay's legs in 1/10^8 (Owarine `combineProb`): the product of the
/// asks rounded up, never under half the lowest ask when two legs settle at the same instant.
pub fn parlay_price_e8(legs: &[LegPrice]) -> Result<u64, ParlayRefusal> {
    if !(PARLAY_MIN_LEGS..=PARLAY_MAX_LEGS).contains(&legs.len()) {
        return Err(ParlayRefusal::Legs);
    }
    let mut price = PRICE_SCALE_E8;
    for leg in legs {
        price = (price * leg.ask_e4).div_ceil(PRICE_SCALE_E4);
    }
    let mut expiries: Vec<i64> = legs.iter().map(|l| l.expiry).collect();
    expiries.sort_unstable();
    expiries.dedup();
    if expiries.len() != legs.len() {
        let lowest = legs
            .iter()
            .map(|l| l.ask_e4)
            .min()
            .unwrap_or(PRICE_SCALE_E4);
        let floor =
            lowest * (PRICE_SCALE_E8 / PRICE_SCALE_E4) * PARLAY_CORRELATION_FLOOR_BPS / BPS_SCALE;
        price = price.max(floor);
    }
    if price < PARLAY_MIN_PRICE_E8 {
        return Err(ParlayRefusal::LongShot);
    }
    Ok(price)
}

/// What a winning parlay pays (u128: a 1 ZEC stake times 10^8 overflows nothing here, but would
/// in u64 at 185 ZEC).
pub fn parlay_payout_zat(stake_zat: u64, price_e8: u64) -> u64 {
    let raw = u128::from(stake_zat) * u128::from(PRICE_SCALE_E8) / u128::from(price_e8);
    floor_to_grid(u64::try_from(raw).unwrap_or(u64::MAX))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegOutcome {
    Won,
    Lost,
    Refund,
}

/// A settled parlay's value: any lost leg loses it all; refunded legs drop out and the rest are
/// priced again with the same rule; all refunded, the stake comes back.
pub fn parlay_settled_zat(stake_zat: u64, legs: &[(LegPrice, LegOutcome)]) -> u64 {
    if legs.iter().any(|(_, o)| *o == LegOutcome::Lost) {
        return 0;
    }
    let decided: Vec<LegPrice> = legs
        .iter()
        .filter(|(_, o)| *o == LegOutcome::Won)
        .map(|(l, _)| *l)
        .collect();
    match decided.as_slice() {
        [] => stake_zat,
        [one] => payout_zat(stake_zat, one.ask_e4),
        _ => parlay_price_e8(&decided).map_or(stake_zat, |p| parlay_payout_zat(stake_zat, p)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../../packages/domain/fixtures/fair.json");

    fn side(v: &Value) -> SideQuote {
        SideQuote {
            ask_e4: v["askE4"].as_u64(),
            bid_e4: v["bidE4"].as_u64(),
        }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() <= 1e-12
    }

    #[test]
    fn matches_the_typescript_prices() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        for case in v["cdf"].as_array().unwrap() {
            let z = case["z"].as_f64().unwrap();
            assert!(close(normal_cdf(z), case["p"].as_f64().unwrap()), "Φ({z})");
        }
        for case in v["fair"].as_array().unwrap() {
            let p = fair_up(
                case["spot"].as_f64().unwrap(),
                case["reference"].as_f64().unwrap(),
                case["sigma"].as_f64().unwrap(),
                case["secondsLeft"].as_i64().unwrap(),
            )
            .unwrap();
            assert!(close(p, case["pUp"].as_f64().unwrap()), "{case}");
            assert_eq!(quote_side(p), side(&case["up"]), "{case}");
            assert_eq!(quote_side(1.0 - p), side(&case["down"]), "{case}");
        }
        for case in v["sides"].as_array().unwrap() {
            assert_eq!(
                quote_side(case["p"].as_f64().unwrap()),
                side(case),
                "{case}"
            );
        }
        for case in v["payouts"].as_array().unwrap() {
            let payout = payout_zat(
                case["stake"].as_u64().unwrap(),
                case["askE4"].as_u64().unwrap(),
            );
            assert_eq!(payout, case["payout"].as_u64().unwrap(), "{case}");
            for c in case["closes"].as_array().unwrap() {
                assert_eq!(
                    close_value_zat(payout, c["bidE4"].as_u64().unwrap()),
                    c["value"].as_u64().unwrap()
                );
            }
        }
    }

    #[test]
    fn matches_the_typescript_windows_and_parlays() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        let (start, expiry) = (
            v["window"]["startSec"].as_i64().unwrap(),
            v["window"]["expirySec"].as_i64().unwrap(),
        );
        for case in v["windows"].as_array().unwrap() {
            let now = case["now"].as_i64().unwrap();
            let state = &case["state"];
            let phase = window_phase(
                start,
                expiry,
                state["reference"].is_string(),
                state["outcome"].is_string(),
                now,
            );
            let name = case["quote"]["phase"].as_str().unwrap();
            let expected = match name {
                "pre" => Phase::Pre,
                "opening" => Phase::Opening,
                "live" => Phase::Live,
                "riding" => Phase::Riding,
                _ => Phase::Settled,
            };
            assert_eq!(phase, expected, "{case}");
            let p_up = match phase {
                Phase::Pre => Some(PRE_OPEN_PROBABILITY),
                Phase::Live => fair_up(
                    case["spot"].as_f64().unwrap(),
                    state["reference"].as_str().unwrap().parse().unwrap(),
                    case["sigma"].as_f64().unwrap(),
                    expiry - now,
                ),
                _ => None,
            };
            if let Some(p) = p_up {
                assert_eq!(quote_side(p), side(&case["quote"]["up"]), "{case}");
                assert_eq!(quote_side(1.0 - p), side(&case["quote"]["down"]), "{case}");
            }
        }
        let legs_of = |legs: &Value| -> Vec<LegPrice> {
            legs.as_array()
                .unwrap()
                .iter()
                .map(|l| LegPrice {
                    ask_e4: l["askE4"].as_u64().unwrap(),
                    expiry: l["expirySec"].as_i64().unwrap(),
                })
                .collect()
        };
        for case in v["parlays"].as_array().unwrap() {
            let price = parlay_price_e8(&legs_of(&case["legs"]));
            if case["price"]["ok"].as_bool().unwrap() {
                let p = price.unwrap();
                assert_eq!(p, case["price"]["priceE8"].as_u64().unwrap(), "{case}");
                assert_eq!(
                    parlay_payout_zat(10_000_000, p),
                    case["payout"].as_u64().unwrap()
                );
            } else {
                let reason = case["price"]["reason"].as_str().unwrap();
                let expected = if reason == "legs" {
                    ParlayRefusal::Legs
                } else {
                    ParlayRefusal::LongShot
                };
                assert_eq!(price, Err(expected), "{case}");
            }
        }
        for case in v["settled"].as_array().unwrap() {
            let legs: Vec<(LegPrice, LegOutcome)> = case["legs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|l| {
                    let outcome = match l["outcome"].as_str().unwrap() {
                        "won" => LegOutcome::Won,
                        "lost" => LegOutcome::Lost,
                        _ => LegOutcome::Refund,
                    };
                    (
                        LegPrice {
                            ask_e4: l["askE4"].as_u64().unwrap(),
                            expiry: l["expirySec"].as_i64().unwrap(),
                        },
                        outcome,
                    )
                })
                .collect();
            assert_eq!(
                parlay_settled_zat(case["stake"].as_u64().unwrap(), &legs),
                case["value"].as_u64().unwrap(),
                "{case}"
            );
        }
    }
}
