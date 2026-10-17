//! Payout-address check for the bet sheet, compiled to WebAssembly.
//!
//! Mirrors `services/operator/src/domain.rs::check_payout_address` (PD18): the payout address must be a
//! Unified Address for the bet's network, with an Orchard receiver and no transparent receiver. A Sapling
//! payout would cross pools and publish the amount; a transparent one would publish the recipient.
//! The operator re-checks at ingest; this check runs only in the browser, so the address never leaves it.

use wasm_bindgen::prelude::wasm_bindgen;
use zcash_address::unified::{self, Encoding as _};
use zcash_protocol::PoolType;
use zcash_protocol::consensus::NetworkType;

/// Why an address can't receive a payout. `Ok` means it can.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Ok,
    NotUnified,
    WrongNetwork,
    NoOrchard,
    Transparent,
    UnknownNetwork,
}

impl Verdict {
    fn code(self) -> &'static str {
        match self {
            Verdict::Ok => "ok",
            Verdict::NotUnified => "not-unified",
            Verdict::WrongNetwork => "wrong-network",
            Verdict::NoOrchard => "no-orchard",
            Verdict::Transparent => "transparent",
            Verdict::UnknownNetwork => "unknown-network",
        }
    }
}

/// The check itself, in the operator's order: decode, network, Orchard present, transparent absent.
pub fn check(address: &str, network: &str) -> Verdict {
    let expected = match network {
        "mainnet" => NetworkType::Main,
        "testnet" => NetworkType::Test,
        _ => return Verdict::UnknownNetwork,
    };
    let Ok((address_network, _revision, ua)) = unified::Address::decode(address.trim()) else {
        return Verdict::NotUnified;
    };
    if address_network != expected {
        return Verdict::WrongNetwork;
    }
    if !ua.has_receiver_of_type(PoolType::ORCHARD) {
        return Verdict::NoOrchard;
    }
    if ua.has_receiver_of_type(PoolType::TRANSPARENT) {
        return Verdict::Transparent;
    }
    Verdict::Ok
}

/// `checkPayoutAddress(ua, network)` → `"ok"` or a reason code
/// (`not-unified`, `wrong-network`, `no-orchard`, `transparent`, `unknown-network`).
#[wasm_bindgen(js_name = checkPayoutAddress)]
pub fn check_payout_address(address: &str, network: &str) -> String {
    check(address, network).code().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Testnet UAs from packages/domain/fixtures/vectors.json (wallet-generated, Orchard + Sapling, no transparent).
    const TESTNET_UA: &str = "utest15a2u8lfvhtc8zuy9jh8mj7cawp7thxr0gjsyl9r4nqa7lrp7wrlcnaqpnenu0z92kzkf2j4j7e6qx6u507gl5wh9uvj95k45dv55vjgd";

    #[test]
    fn accepts_a_testnet_orchard_address_on_testnet() {
        assert_eq!(check(TESTNET_UA, "testnet"), Verdict::Ok);
    }

    #[test]
    fn rejects_the_other_network() {
        assert_eq!(check(TESTNET_UA, "mainnet"), Verdict::WrongNetwork);
    }

    #[test]
    fn rejects_non_unified_input() {
        assert_eq!(
            check("tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd", "testnet"),
            Verdict::NotUnified
        );
        assert_eq!(check("hello", "testnet"), Verdict::NotUnified);
    }

    fn encode(receivers: Vec<unified::Receiver>) -> String {
        let items = receivers.into_iter().map(unified::Uitem::Data).collect();
        unified::Address::try_from_items(unified::Revision::R0, items)
            .expect("valid receiver set")
            .encode(&NetworkType::Test)
    }

    #[test]
    fn rejects_a_sapling_only_address() {
        let sapling_only = encode(vec![unified::Receiver::Sapling([7; 43])]);
        assert_eq!(check(&sapling_only, "testnet"), Verdict::NoOrchard);
    }

    #[test]
    fn rejects_a_transparent_receiver_next_to_orchard() {
        let with_transparent = encode(vec![
            unified::Receiver::Orchard([7; 43]),
            unified::Receiver::P2pkh([9; 20]),
        ]);
        assert_eq!(check(&with_transparent, "testnet"), Verdict::Transparent);
    }

    #[test]
    fn rejects_unknown_networks() {
        assert_eq!(check(TESTNET_UA, "regtest"), Verdict::UnknownNetwork);
    }
}
