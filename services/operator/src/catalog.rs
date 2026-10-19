//! The market catalog: which markets exist, their ids, times and rules.
//!
//! Markets are created one window ahead, so their rules (and `rulesHash`) are fixed and
//! published before betting opens (D13, plan §13.5). Rules are never rewritten afterwards:
//! the engine stores the canonical rules JSON at creation and republishes it verbatim.

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use crate::{
    domain::{
        CUTOFF_BEFORE_CLOSE_SECS, FINALITY_CONFIRMATIONS, MIN_NEW_TICKETS_PER_RELEASE,
        MIN_TICKETS_PER_SIDE, is_market_id,
    },
    payouts::Window,
    signing::{canonical_json, rules_hash},
    venues::{Venue, VenuePair},
    wallet::Net,
};

pub const HOUR_SECS: i64 = 3_600;
pub const DAY_SECS: i64 = 86_400;

/// A crypto asset with an Up/Down market and the three venues that vote on it (PD20).
pub struct Asset {
    /// Lower-case key used in market ids.
    pub key: &'static str,
    pub ticker: &'static str,
    pub venues: [VenuePair; 3],
}

const fn pairs(coinbase: &'static str, kraken: &'static str, third: VenuePair) -> [VenuePair; 3] {
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

/// Coinbase + Kraken + Bitstamp; ZEC uses Gemini instead of Bitstamp, whose ZEC book is thin
/// (zcash-stack-and-feeds §5.2–5.3). Stocks come later (keys pending).
pub const ASSETS: [Asset; 6] = [
    Asset {
        key: "btc",
        ticker: "BTC",
        venues: pairs("BTC-USD", "XBTUSD", bitstamp("btcusd")),
    },
    Asset {
        key: "eth",
        ticker: "ETH",
        venues: pairs("ETH-USD", "ETHUSD", bitstamp("ethusd")),
    },
    Asset {
        key: "sol",
        ticker: "SOL",
        venues: pairs("SOL-USD", "SOLUSD", bitstamp("solusd")),
    },
    Asset {
        key: "zec",
        ticker: "ZEC",
        venues: pairs(
            "ZEC-USD",
            "ZECUSD",
            VenuePair {
                venue: Venue::Gemini,
                pair: "zecusd",
            },
        ),
    },
    Asset {
        key: "xrp",
        ticker: "XRP",
        venues: pairs("XRP-USD", "XRPUSD", bitstamp("xrpusd")),
    },
    Asset {
        key: "doge",
        ticker: "DOGE",
        venues: pairs("DOGE-USD", "XDGUSD", bitstamp("dogeusd")),
    },
];

/// Hourly Up/Down markets (user decision 2).
pub const HOURLY: [&str; 4] = ["btc", "eth", "sol", "zec"];
/// Daily Up/Down markets, 00:00 → 24:00 UTC.
pub const DAILY: [&str; 6] = ["btc", "eth", "sol", "zec", "xrp", "doge"];

/// Testnet event: "testnet reaches height H before T" (plan §13.6), H = tip + this, T = now + 2 days.
pub const TESTNET_EVENT_BLOCKS_AHEAD: u32 = 1_500;
pub const TESTNET_EVENT_DURATION_SECS: i64 = 2 * DAY_SECS;
pub const TESTNET_EVENT_SUBJECT: &str = "tnheight";
/// Mainnet NU7 event (plan §13.6): created only on mainnet.
pub const NU7_SUBJECT: &str = "nu7";
/// 2026-11-12T00:00:00Z: one week after the tentative Nov 5 activation, inside judging.
pub const NU7_DEADLINE: i64 = 1_794_441_600;
pub const NU7_BRANCH_ID: &str = "0x77190AD9";

pub fn asset(key: &str) -> Option<&'static Asset> {
    ASSETS.iter().find(|a| a.key == key)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Close,
    Event,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Close => "close",
            Kind::Event => "event",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "close" => Some(Kind::Close),
            "event" => Some(Kind::Event),
            _ => None,
        }
    }
}

/// A market as created, before any betting.
pub struct NewMarket {
    pub id: String,
    pub kind: Kind,
    pub subject: String,
    pub window: &'static str,
    pub opens_at: i64,
    pub cutoff_at: i64,
    pub closes_at: i64,
    /// Canonical JSON of the rules object; `rules_hash` is its BLAKE2b-256.
    pub rules: String,
    pub rules_hash: String,
    /// Event markets resolved by chain height (testnet).
    pub target_height: Option<u32>,
    /// Bets must also be mined below this height (a height event's outcome is known at H).
    pub bet_height_cap: Option<u32>,
    /// The payout window the rules state; payouts for this market use exactly this window (O2).
    pub payout_window: Window,
    /// Strike markets: the strike in whole US dollars (Range / Moonshot ladders).
    pub strike: Option<u64>,
    /// Strike markets: the opening reference fixed at creation (`{venue: strike}`, canonical JSON).
    pub opening: Option<String>,
}

/// Daily assets that also get a ladder of strike markets ("BTC above $X at close?").
pub const LADDER: [&str; 4] = ["btc", "eth", "sol", "zec"];
/// Rung offsets from the reference price, in basis points: the near rungs are Range, the far ones Moonshot.
pub const LADDER_OFFSETS_BPS: [i64; 6] = [-500, -250, -100, 100, 250, 500];
/// Ladders are created this long before their day opens, so strikes start near the money.
pub const LADDER_LEAD_SECS: i64 = 2 * HOUR_SECS;
/// Strikes round to a tidy step of about this fraction of the price (25 bps), never below $1.
const STRIKE_STEP_BPS: u128 = 25;
const BPS: u128 = 10_000;
const CENTS_PER_DOLLAR: u128 = 100;
/// Tidy step multipliers within a decade.
const NICE_STEPS: [u128; 3] = [1, 2, 5];
const DECADE: u128 = 10;

/// The day a ladder is due for: the next day's start, once `now` is within `LADDER_LEAD_SECS` of it.
pub fn ladder_due(now: i64) -> Option<i64> {
    let day = next_window_start(now, DAY_SECS);
    (now >= day - LADDER_LEAD_SECS).then_some(day)
}

/// Parses a venue's decimal price ("82651.98") into whole cents, rounding half up past two decimals.
pub fn price_cents(price: &str) -> Option<u128> {
    let (whole, frac) = price.split_once('.').unwrap_or((price, ""));
    let whole: u128 = whole.parse().ok()?;
    let mut digits = frac.chars().chain(std::iter::repeat('0'));
    let mut cents = whole * CENTS_PER_DOLLAR;
    for scale in [DECADE, 1] {
        cents += u128::from(digits.next()?.to_digit(10)?) * scale;
    }
    if digits.next()?.to_digit(10)? >= 5 {
        cents += 1;
    }
    Some(cents)
}

/// Whole-dollar strikes around `reference_cents`, one per offset, rounded to a tidy step; duplicates removed.
pub fn strikes(reference_cents: u128) -> Vec<u64> {
    let raw_step = (reference_cents * STRIKE_STEP_BPS / BPS / CENTS_PER_DOLLAR).max(1);
    let mut decade = 1;
    while decade * DECADE <= raw_step {
        decade *= DECADE;
    }
    let step = NICE_STEPS
        .iter()
        .map(|m| m * decade)
        .filter(|s| *s <= raw_step)
        .max()
        .unwrap_or(1);
    let mut out: Vec<u64> = LADDER_OFFSETS_BPS
        .iter()
        .filter_map(|bps| {
            let target = reference_cents as i128 * (BPS as i128 + i128::from(*bps)) / BPS as i128;
            let dollars = u128::try_from(target).ok()? / CENTS_PER_DOLLAR;
            let rounded = (dollars + step / 2) / step * step;
            u64::try_from(rounded).ok().filter(|s| *s > 0)
        })
        .collect();
    out.dedup();
    out
}

pub fn iso(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .expect("timestamp in range")
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

fn human(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .expect("timestamp in range")
        .format("%Y-%m-%d %H:%M")
        .to_string()
}

/// `<subject>-<window>-<yymmddHHMM close UTC>`, matching `MARKET_ID_PATTERN`.
pub fn market_id(subject: &str, window: &str, closes_at: i64) -> String {
    let close = DateTime::<Utc>::from_timestamp(closes_at, 0)
        .expect("timestamp in range")
        .format("%y%m%d%H%M");
    let id = format!("{subject}-{window}-{close}");
    debug_assert!(is_market_id(&id), "{id}");
    id
}

/// Start of the next window of `length` seconds strictly after `now` (windows align to UTC).
pub fn next_window_start(now: i64, length: i64) -> i64 {
    (now.div_euclid(length) + 1) * length
}

fn shared_cancellation(extra: &str) -> String {
    format!(
        "Ticket counts, ticket hashes and side totals are published only in releases of at least \
         {MIN_NEW_TICKETS_PER_RELEASE} new tickets of the same side, so no release singles out one bet. A side's tickets \
         still unreleased when the cutoff block H_c is final (fewer than {MIN_NEW_TICKETS_PER_RELEASE} on that side) are \
         refunded in full and never counted. Every counted ticket is refunded if either side has fewer than {MIN_TICKETS_PER_SIDE} counted \
         tickets at the cutoff{extra}. \
         Refunds to the memo's payout address: bets mined at or after the cutoff block H_c, bets mined before betting \
         opened, wrong amounts of 0.001 ZEC or more (smaller amounts are kept as dust), a side this market does not have, \
         and a repeated nonce (the first by block height and transaction index counts). A missing or malformed memo, a \
         memo for another network, or a payout address without an Orchard receiver leaves no usable return address: those \
         funds are unrecoverable."
    )
}

fn betting_window(opens_at: i64, cutoff_at: i64) -> String {
    format!(
        "Bets count if mined from the first block with a timestamp at or after {} up to, but not including, the cutoff \
         block H_c: the first block with a timestamp at or after {}, taken once it has {FINALITY_CONFIRMATIONS} \
         confirmations (miners set timestamps within consensus limits).",
        iso(opens_at),
        iso(cutoff_at)
    )
}

/// "2 to 6 hours" (or minutes or seconds, whichever unit divides both ends).
fn span(window: Window) -> String {
    for (unit, name) in [(HOUR_SECS, "hours"), (60, "minutes"), (1, "seconds")] {
        if window.min % unit == 0 && window.max % unit == 0 {
            return format!("{} to {} {name}", window.min / unit, window.max / unit);
        }
    }
    unreachable!("every window is whole seconds")
}

/// The payout sentence, written from the same window the scheduler uses for this market (O2).
fn payout_formula(window: Window) -> String {
    format!(
        "A winning ticket of size s receives s + round(s × L × (10000 − 200) / (W × 10000)) zatoshi, rounded to the \
         nearest 100000 zatoshi (0.001 ZEC, half up), where W and L are the winning and losing pools at the cutoff. \
         The 2% fee comes from the losing side only; the house absorbs the rounding either way. Each payout is split \
         into canonical 1, 2 or 5 × 10^k zatoshi notes, each sent as its own transaction at a random time {} after \
         resolution.",
        span(window)
    )
}

#[allow(clippy::too_many_arguments)]
fn finish(
    subject: &str,
    window: &'static str,
    kind: Kind,
    opens_at: i64,
    closes_at: i64,
    rules: &Value,
    target_height: Option<u32>,
    payout_window: Window,
) -> Result<NewMarket> {
    Ok(NewMarket {
        id: market_id(&subject.to_lowercase(), window, closes_at),
        kind,
        subject: subject.to_string(),
        window,
        opens_at,
        cutoff_at: closes_at - CUTOFF_BEFORE_CLOSE_SECS,
        closes_at,
        rules: canonical_json(rules)?,
        rules_hash: rules_hash(rules)?,
        target_height,
        bet_height_cap: target_height,
        payout_window,
        strike: None,
        opening: None,
    })
}

/// "Will BTC/USD close above $85,000 at <close>?": an ordinary Up/Down pool whose opening reference is the strike
/// for every venue, fixed in these signed rules before betting opens (Range / Moonshot, plan §0).
pub fn strike_market(
    asset: &Asset,
    opens_at: i64,
    closes_at: i64,
    strike: u64,
    reference: (&str, i64),
    payout: Window,
) -> Result<NewMarket> {
    let cutoff_at = closes_at - CUTOFF_BEFORE_CLOSE_SECS;
    let ticker = asset.ticker;
    let (reference_price, reference_end) = reference;
    let venues: Vec<String> = asset
        .venues
        .iter()
        .map(|v| format!("{} {}", v.venue.label(), v.pair))
        .collect();
    let rules = json!({
        "question": format!(
            "{ticker} above ${strike} at {} UTC: will {ticker}/USD close above ${strike} at {}?",
            human(closes_at), iso(closes_at)
        ),
        "resolution": format!(
            "Each venue ({}) votes Up (above) or Down (below) by comparing the close of its committed 1-hour {ticker}/USD \
             candle ending {} with the strike ${strike}. A close exactly at the strike is Flat. Up or Down wins with at \
             least 2 of the 3 venue votes; a missing or zero-volume candle is no vote. The strike was set when this market \
             was created, from the Coinbase 1-hour close of {reference_price} ending {}, and cannot change. {}",
            venues.join(", "), iso(closes_at), iso(reference_end), betting_window(opens_at, cutoff_at)
        ),
        "sources": asset.venues.iter().map(|v| v.venue.source(v.pair)).collect::<Vec<_>>(),
        "cancellation": shared_cancellation(", or if no direction gets 2 of the 3 venue votes"),
        "payoutFormula": payout_formula(payout),
    });
    let mut market = finish(
        ticker,
        "1d",
        Kind::Close,
        opens_at,
        closes_at,
        &rules,
        None,
        payout,
    )?;
    market.id = format!("{}-a{strike}", market.id);
    debug_assert!(is_market_id(&market.id), "{}", market.id);
    let opening: serde_json::Map<String, Value> = asset
        .venues
        .iter()
        .map(|v| (v.venue.key().to_string(), Value::String(strike.to_string())))
        .collect();
    market.opening = Some(canonical_json(&Value::Object(opening))?);
    market.strike = Some(strike);
    Ok(market)
}

/// An Up/Down market on `asset` for the window `[opens_at, closes_at)`.
pub fn close_market(
    asset: &Asset,
    opens_at: i64,
    closes_at: i64,
    payout: Window,
) -> Result<NewMarket> {
    let window = if closes_at - opens_at == HOUR_SECS {
        "1h"
    } else {
        "1d"
    };
    let cutoff_at = closes_at - CUTOFF_BEFORE_CLOSE_SECS;
    let ticker = asset.ticker;
    let venues: Vec<String> = asset
        .venues
        .iter()
        .map(|v| format!("{} {}", v.venue.label(), v.pair))
        .collect();
    let rules = json!({
        "question": format!(
            "{ticker} Up or Down, {} to {} UTC: will {ticker}/USD close higher at {} than it was at {}?",
            human(opens_at), human(closes_at), iso(closes_at), iso(opens_at)
        ),
        "resolution": format!(
            "Each venue ({}) votes Up, Down or Flat by comparing the close of its committed 1-hour {ticker}/USD candle \
             ending {} with its opening reference: the close of its committed 1-hour candle ending {opens}, which is \
             fixed at {opens} and published, signed, in the first bundle after it. Up or Down wins with at least 2 of the 3 venue votes. A missing or \
             zero-volume candle is no vote. {}",
            venues.join(", "), iso(closes_at), betting_window(opens_at, cutoff_at), opens = iso(opens_at)
        ),
        "sources": asset.venues.iter().map(|v| v.venue.source(v.pair)).collect::<Vec<_>>(),
        "cancellation": shared_cancellation(
            ", if no direction gets 2 of the 3 venue votes, or if fewer than 2 venues give an opening reference"
        ),
        "payoutFormula": payout_formula(payout),
    });
    finish(
        ticker,
        window,
        Kind::Close,
        opens_at,
        closes_at,
        &rules,
        None,
        payout,
    )
}

/// Testnet: "Zcash testnet reaches height H before T", resolved from chain data in S03.
pub fn testnet_height_market(
    opens_at: i64,
    closes_at: i64,
    height: u32,
    payout: Window,
) -> Result<NewMarket> {
    let cutoff_at = closes_at - CUTOFF_BEFORE_CLOSE_SECS;
    let rules = json!({
        "question": format!("Will Zcash testnet reach block height {height} before {}?", iso(closes_at)),
        "resolution": format!(
            "Yes if block {height} of the testnet best chain has a median-time-past (the median timestamp of the 11 \
             blocks ending at it) before {deadline}, with {FINALITY_CONFIRMATIONS} confirmations. No once a block whose \
             median-time-past is at or after {deadline} has {FINALITY_CONFIRMATIONS} confirmations and block {height} \
             has not met that condition. Read from compact blocks served by public light-wallet servers. {} Bets \
             mined at or above block {height} are refunded as late, since the outcome is known from that block.",
            betting_window(opens_at, cutoff_at),
            deadline = iso(closes_at),
        ),
        "sources": [
            "Zcash testnet compact blocks, lightwalletd gRPC: testnet.zec.rocks:443",
            "Browser re-verify, gRPC-web: https://zjs.zec.rocks/testnet",
        ],
        "cancellation": shared_cancellation(", or if the light-wallet servers disagree on the best chain at resolution"),
        "payoutFormula": payout_formula(payout),
    });
    finish(
        TESTNET_EVENT_SUBJECT,
        "event",
        Kind::Event,
        opens_at,
        closes_at,
        &rules,
        Some(height),
        payout,
    )
}

/// Mainnet: "NU7 activates on mainnet before the deadline" (plan §13.6). Never created on testnet,
/// where NU7 activated at 4,465,026.
pub fn nu7_market(opens_at: i64, payout: Window) -> Result<NewMarket> {
    let cutoff_at = NU7_DEADLINE - CUTOFF_BEFORE_CLOSE_SECS;
    let deadline = iso(NU7_DEADLINE);
    let rules = json!({
        "question": format!("Will NU7 be active on Zcash mainnet before {deadline}?"),
        "resolution": format!(
            "Yes if a block B on the mainnet best chain has a coinbase transaction whose nConsensusBranchId (bytes 8 to \
             11, little-endian) is {NU7_BRANCH_ID}, the median-time-past of B (the median timestamp of the 11 blocks \
             ending at it) is before {deadline}, and B has {FINALITY_CONFIRMATIONS} confirmations. Otherwise No at the \
             deadline. Chain split: ZIP 259 lets pre-NU7 software keep extending a pre-NU7 branch; only the branch whose \
             blocks carry {NU7_BRANCH_ID} is read for Yes, and a pre-NU7 branch alone never resolves the market before \
             the deadline. {}",
            betting_window(opens_at, cutoff_at)
        ),
        "sources": [
            "Zcash mainnet coinbase transactions, lightwalletd gRPC: zec.rocks:443 and us.zec.stardust.rest:443",
            "ZIP 259 (NU7, CONSENSUS_BRANCH_ID 0x77190AD9): https://zips.z.cash/zip-0259",
            "Browser re-verify, gRPC-web: https://zjs.zec.rocks/mainnet",
        ],
        "cancellation": shared_cancellation(
            ", or if the two light-wallet servers disagree at resolution on whether a qualifying block exists"
        ),
        "payoutFormula": payout_formula(payout),
    });
    finish(
        NU7_SUBJECT,
        "event",
        Kind::Event,
        opens_at,
        NU7_DEADLINE,
        &rules,
        None,
        payout,
    )
}

/// The close markets that should exist at `now`: the next hourly and the next daily window.
pub fn due_close_markets(now: i64, payout: Window) -> Result<Vec<NewMarket>> {
    let mut out = vec![];
    let hour = next_window_start(now, HOUR_SECS);
    for key in HOURLY {
        out.push(close_market(
            asset(key).expect("catalog asset"),
            hour,
            hour + HOUR_SECS,
            payout,
        )?);
    }
    let day = next_window_start(now, DAY_SECS);
    for key in DAILY {
        out.push(close_market(
            asset(key).expect("catalog asset"),
            day,
            day + DAY_SECS,
            payout,
        )?);
    }
    Ok(out)
}

/// The event market to create when none is pending on this network.
pub fn due_event_market(
    net: Net,
    now: i64,
    tick_secs: i64,
    tip: u32,
    payout: Window,
) -> Result<Option<NewMarket>> {
    let opens_at = next_window_start(now, tick_secs);
    match net {
        Net::Testnet => {
            let closes_at = next_window_start(now + TESTNET_EVENT_DURATION_SECS, tick_secs);
            testnet_height_market(
                opens_at,
                closes_at,
                tip + TESTNET_EVENT_BLOCKS_AHEAD,
                payout,
            )
            .map(Some)
        }
        Net::Mainnet if opens_at < NU7_DEADLINE - CUTOFF_BEFORE_CLOSE_SECS => {
            nu7_market(opens_at, payout).map(Some)
        }
        Net::Mainnet => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_windows() {
        // 2026-10-17T18:20:00Z
        let now = 1_792_261_200;
        let markets = due_close_markets(now, Window::default()).expect("markets");
        assert_eq!(markets[0].id, "btc-1h-2610172000");
        assert_eq!(iso(markets[0].opens_at), "2026-10-17T19:00:00Z");
        assert_eq!(iso(markets[0].cutoff_at), "2026-10-17T19:50:00Z");
        let daily = markets
            .iter()
            .find(|m| m.id.starts_with("doge-1d"))
            .expect("daily");
        assert_eq!(daily.id, "doge-1d-2610190000");
        assert_eq!(iso(daily.opens_at), "2026-10-18T00:00:00Z");
        assert!(markets.iter().all(|m| is_market_id(&m.id)));
        let event = nu7_market(now, Window::default()).expect("nu7");
        assert_eq!(event.id, "nu7-event-2611120000");
        assert_eq!(iso(NU7_DEADLINE), "2026-11-12T00:00:00Z");
        // Rules are stored canonically and hashed once.
        let rules: Value = serde_json::from_str(&markets[0].rules).expect("rules");
        assert_eq!(rules_hash(&rules).expect("hash"), markets[0].rules_hash);
        // The payout sentence comes from the market's own window (O2), and PD28 is in the rules.
        let formula = rules["payoutFormula"].as_str().expect("formula");
        assert!(formula.ends_with("at a random time 2 to 6 hours after resolution."));
        let quick = Window { min: 120, max: 900 };
        assert_eq!(span(quick), "2 to 15 minutes");
        assert_eq!(span(Window { min: 90, max: 900 }), "90 to 900 seconds");
        assert!(
            rules["cancellation"]
                .as_str()
                .expect("cancellation")
                .contains("refunded in full and never counted")
        );
    }

    #[test]
    fn price_cents_rounds_half_up() {
        assert_eq!(price_cents("82651.98"), Some(8_265_198));
        assert_eq!(price_cents("82651.985"), Some(8_265_199));
        assert_eq!(price_cents("45"), Some(4_500));
        assert_eq!(price_cents("0.1234"), Some(12));
        assert_eq!(price_cents("x1"), None);
    }

    #[test]
    fn strikes_are_tidy_and_ordered() {
        // BTC at $82,651.98: step ≈ 25 bps ≈ $206 → $200; rungs at -5 %, -2.5 %, -1 %, +1 %, +2.5 %, +5 %.
        let btc = strikes(8_265_198);
        assert_eq!(btc, [78_600, 80_600, 81_800, 83_400, 84_800, 86_800]);
        assert!(btc.iter().all(|s| s % 200 == 0));
        // ZEC at $45.10: step floors at $1; nearby rungs may coincide and are deduplicated.
        let zec = strikes(4_510);
        assert!(zec.windows(2).all(|w| w[0] < w[1]), "{zec:?}");
        assert!(zec.iter().all(|s| *s > 0));
    }

    #[test]
    fn strike_market_fixes_its_opening() {
        let asset = asset("btc").expect("btc");
        let day = 1_792_368_000;
        let m = strike_market(
            asset,
            day,
            day + DAY_SECS,
            85_000,
            ("82651.98", day - LADDER_LEAD_SECS),
            Window {
                min: 7_200,
                max: 21_600,
            },
        )
        .expect("market");
        assert!(m.id.ends_with("-a85000") && is_market_id(&m.id), "{}", m.id);
        assert_eq!(m.strike, Some(85_000));
        let opening: Value =
            serde_json::from_str(m.opening.as_deref().expect("opening")).expect("json");
        assert!(
            opening
                .as_object()
                .expect("map")
                .values()
                .all(|v| v == "85000")
        );
        assert!(m.rules.contains("close above $85000"));
    }

    #[test]
    fn ladders_are_due_inside_the_lead() {
        let day = 1_792_368_000;
        assert_eq!(ladder_due(day - LADDER_LEAD_SECS - 1), None);
        assert_eq!(ladder_due(day - LADDER_LEAD_SECS), Some(day));
    }
}
