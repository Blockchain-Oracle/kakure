//! Rust mirror of `packages/domain` (memo codec, ticket hash, payout maths).
//! The TypeScript package is the reference; `packages/domain/fixtures/vectors.json` keeps both identical.

use anyhow::{Context, Result, anyhow, bail, ensure};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use zcash_address::unified::{self, Encoding as _};
use zcash_protocol::PoolType;
use zcash_protocol::consensus::NetworkType;

pub const ZATOSHI_PER_ZEC: u64 = 100_000_000;
/// ZIP 318 canonical ticket sizes (0.01 … 1 ZEC).
pub const TICKET_SIZES_ZAT: [u64; 7] = [
    1_000_000,
    2_000_000,
    5_000_000,
    10_000_000,
    20_000_000,
    50_000_000,
    100_000_000,
];
pub const FEE_BPS: u128 = 200;
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const PAYOUT_GRID_ZAT: u128 = 100_000;
pub const REFUND_MIN_ZAT: u64 = 100_000;
pub const MIN_TICKETS_PER_SIDE: u32 = 3;
pub const MEMO_PREFIX: &str = "kakure:v1";
pub const MEMO_MAX_BYTES: usize = 511;
pub const MEMO_FIELDS: [&str; 6] = ["n", "m", "s", "z", "k", "p"];
pub const NONCE_BYTES: usize = 16;
pub const TICKET_HASH_PERSONAL: &[u8; 16] = b"Kakure_Ticket_v1";
/// `rulesHash` = BLAKE2b-256 with this personalisation over the canonical rules JSON (D13).
pub const RULES_HASH_PERSONAL: &[u8; 16] = b"Kakure_Rules_v01";
/// `latest.bundleHash`, `bundle.previous` and `addresses-<first 8 hex>.json` use SHA-256 (hex)
/// over the exact bytes of the published file, which is the canonical JSON of the signed document.
pub const BUNDLE_HASH_ALGORITHM: &str = "SHA-256";
pub const SCHEMA_VERSION: u32 = 1;
pub const MIN_NEW_TICKETS_PER_RELEASE: u32 = 3;
pub const BATCH_INTERVAL_SECS: u64 = 10 * 60;
pub const CUTOFF_BEFORE_CLOSE_SECS: i64 = 10 * 60;
pub const FINALITY_CONFIRMATIONS: u32 = 10;
pub const CLOSING_WARNING_BLOCKS: i64 = 3;
pub const ADDRESS_LIST_SIZE: u32 = 1024;
/// Market address lists start at diversifier index 1: index 0 is the account's default
/// Orchard + Sapling address (S00 finding).
pub const ADDRESS_FIRST_INDEX: u32 = 1;
pub const CLOSE_SIDES: [&str; 2] = ["U", "D"];
pub const EVENT_SIDES: [&str; 2] = ["Y", "N"];
const CANONICAL_MULTIPLIERS: [u64; 3] = [5, 2, 1];
const SIDES: [&str; 4] = ["U", "D", "Y", "N"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Mainnet,
    Testnet,
}

impl Network {
    pub fn memo_code(self) -> &'static str {
        match self {
            Network::Mainnet => "m",
            Network::Testnet => "t",
        }
    }
    pub fn hash_byte(self) -> u8 {
        match self {
            Network::Mainnet => 0x01,
            Network::Testnet => 0x02,
        }
    }
    fn address_network(self) -> NetworkType {
        match self {
            Network::Mainnet => NetworkType::Main,
            Network::Testnet => NetworkType::Test,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BetMemo {
    pub network: Network,
    pub market_id: String,
    pub side: String,
    pub size_zat: u64,
    pub nonce: [u8; NONCE_BYTES],
    pub payout_address: String,
}

/// Parses a received memo strictly (exact prefix and field order), ignoring Zingo's "\nReply to:" tail.
pub fn decode_bet_memo(raw: &str) -> Result<BetMemo> {
    let memo = raw.lines().next().unwrap_or_default().trim();
    ensure!(memo.len() <= MEMO_MAX_BYTES, "memo too long");
    let mut parts = memo.split(';');
    ensure!(parts.next() == Some(MEMO_PREFIX), "not a Kakure bet memo");

    let mut values = Vec::with_capacity(MEMO_FIELDS.len());
    for expected in MEMO_FIELDS {
        let field = parts
            .next()
            .ok_or_else(|| anyhow!("missing field {expected}"))?;
        let (key, value) = field
            .split_once('=')
            .ok_or_else(|| anyhow!("bad field {field}"))?;
        ensure!(key == expected, "expected field {expected}, found {key}");
        values.push(value.to_owned());
    }
    ensure!(parts.next().is_none(), "unexpected trailing field");

    let network = match values[0].as_str() {
        "m" => Network::Mainnet,
        "t" => Network::Testnet,
        other => bail!("unknown network code {other}"),
    };
    let size_zat: u64 = values[3].parse().context("ticket size is not an integer")?;
    let nonce_bytes = URL_SAFE_NO_PAD
        .decode(&values[4])
        .context("nonce is not base64url")?;
    let nonce: [u8; NONCE_BYTES] = nonce_bytes
        .try_into()
        .map_err(|_| anyhow!("nonce must be 16 bytes"))?;

    let bet = BetMemo {
        network,
        market_id: values[1].clone(),
        side: values[2].clone(),
        size_zat,
        nonce,
        payout_address: values[5].clone(),
    };
    validate(&bet)?;
    Ok(bet)
}

pub fn encode_bet_memo(bet: &BetMemo) -> Result<String> {
    validate(bet)?;
    let memo = format!(
        "{MEMO_PREFIX};n={};m={};s={};z={};k={};p={}",
        bet.network.memo_code(),
        bet.market_id,
        bet.side,
        bet.size_zat,
        URL_SAFE_NO_PAD.encode(bet.nonce),
        bet.payout_address
    );
    ensure!(memo.len() <= MEMO_MAX_BYTES, "memo too long");
    Ok(memo)
}

/// PD18: a payout address must be a Unified Address for this network with an Orchard receiver
/// and no transparent receiver (a Sapling-only payout would cross pools and publish the amount).
pub fn check_payout_address(address: &str, network: Network) -> Result<()> {
    let (address_network, _revision, ua) = unified::Address::decode(address)
        .map_err(|error| anyhow!("not a Unified Address: {error}"))?;
    ensure!(
        address_network == network.address_network(),
        "payout address is for another network"
    );
    ensure!(
        ua.has_receiver_of_type(PoolType::ORCHARD),
        "payout address has no Orchard receiver"
    );
    ensure!(
        !ua.has_receiver_of_type(PoolType::TRANSPARENT),
        "payout address has a transparent receiver"
    );
    Ok(())
}

/// BLAKE2b-256(personal "Kakure_Ticket_v1", net ‖ len(m) ‖ m ‖ side ‖ size_zat u64 LE ‖ nonce16).
pub fn ticket_hash(bet: &BetMemo) -> [u8; 32] {
    let mut state = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(TICKET_HASH_PERSONAL)
        .to_state();
    let market = bet.market_id.as_bytes();
    state.update(&[bet.network.hash_byte(), market.len() as u8]);
    state.update(market);
    state.update(bet.side.as_bytes());
    state.update(&bet.size_zat.to_le_bytes());
    state.update(&bet.nonce);
    let mut out = [0u8; 32];
    out.copy_from_slice(state.finalize().as_bytes());
    out
}

/// Parimutuel payout for one winning ticket: stake + stake × losing × (1 − fee) / winning,
/// rounded to the nearest 0.001 ZEC (half up). u128 can't overflow for any realistic pool.
pub fn payout_zat(size_zat: u64, winning_pool_zat: u64, losing_pool_zat: u64) -> Result<u64> {
    ensure!(
        TICKET_SIZES_ZAT.contains(&size_zat),
        "not a ticket size: {size_zat}"
    );
    ensure!(winning_pool_zat > 0, "winning pool must be positive");
    let numerator =
        u128::from(size_zat) * u128::from(losing_pool_zat) * (BPS_DENOMINATOR - FEE_BPS);
    let grid_denominator = u128::from(winning_pool_zat) * BPS_DENOMINATOR * PAYOUT_GRID_ZAT;
    let steps = (numerator * 2 + grid_denominator) / (grid_denominator * 2);
    let winnings = u64::try_from(steps * PAYOUT_GRID_ZAT).context("payout overflows u64")?;
    size_zat
        .checked_add(winnings)
        .ok_or_else(|| anyhow!("payout overflows u64"))
}

/// Splits an amount into canonical 1/2/5 × 10^k notes, largest first (each sent as its own transaction).
pub fn canonical_notes(amount_zat: u64) -> Vec<u64> {
    let mut notes = Vec::new();
    let mut rest = amount_zat;
    let mut unit = 1u64;
    while unit.checked_mul(10).is_some_and(|next| next <= rest) {
        unit *= 10;
    }
    while unit >= 1 && rest > 0 {
        for multiplier in CANONICAL_MULTIPLIERS {
            let note = multiplier * unit;
            while rest >= note {
                notes.push(note);
                rest -= note;
            }
        }
        unit /= 10;
    }
    notes
}

/// `MARKET_ID_PATTERN`: `^[a-z0-9][a-z0-9-]{2,47}$`.
pub fn is_market_id(id: &str) -> bool {
    (3..=48).contains(&id.len())
        && id
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn validate(bet: &BetMemo) -> Result<()> {
    let id = &bet.market_id;
    ensure!(is_market_id(id), "bad market id {id}");
    ensure!(SIDES.contains(&bet.side.as_str()), "bad side {}", bet.side);
    ensure!(
        TICKET_SIZES_ZAT.contains(&bet.size_zat),
        "not a ticket size: {}",
        bet.size_zat
    );
    check_payout_address(&bet.payout_address, bet.network)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTORS: &str = include_str!("../../../packages/domain/fixtures/vectors.json");

    #[test]
    fn matches_typescript_vectors() {
        let vectors: serde_json::Value = serde_json::from_str(VECTORS).expect("fixtures parse");
        for case in vectors["memos"].as_array().expect("memo cases") {
            let memo = case["memo"].as_str().expect("memo");
            let bet = decode_bet_memo(memo).expect("decodes");
            assert_eq!(encode_bet_memo(&bet).expect("encodes"), memo);
            assert_eq!(
                hex::encode(ticket_hash(&bet)),
                case["ticketHash"].as_str().expect("hash")
            );
        }
        for case in vectors["payouts"].as_array().expect("payout cases") {
            let get = |key: &str| case[key].as_str().expect(key).parse::<u64>().expect("u64");
            let payout = payout_zat(get("sizeZat"), get("winningPoolZat"), get("losingPoolZat"))
                .expect("payout");
            assert_eq!(payout, get("payoutZat"));
            let notes: Vec<u64> = case["notes"]
                .as_array()
                .expect("notes")
                .iter()
                .map(|note| note.as_str().expect("note").parse().expect("u64"))
                .collect();
            assert_eq!(canonical_notes(payout), notes);
        }
    }
}
