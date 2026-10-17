//! Consensus parameters with the NU7 survival fallback (plan §3).
//!
//! The pinned `zcash_protocol` knows NU7 on testnet (4,465,026) but not on mainnet. ZIP 259 sets
//! the mainnet height; `KAKURE_NU7_ACTIVATION_HEIGHT` carries it here:
//! - with `KAKURE_NU7_PARAMS_FALLBACK=1`, the operator uses that height as NU7's activation
//!   height wherever the crate has none (the config-driven `Parameters` fallback);
//! - otherwise payouts pause automatically from that height minus `NU7_PAUSE_MARGIN_BLOCKS`
//!   while the build does not know NU7 (a pre-NU7 transaction would not survive activation).

use anyhow::{Context, Result, bail};
use zcash_protocol::consensus::{self, BlockHeight, NetworkType, NetworkUpgrade, Parameters};

use crate::domain::NU7_PAUSE_MARGIN_BLOCKS;

const ENV_NU7_HEIGHT: &str = "KAKURE_NU7_ACTIVATION_HEIGHT";
const ENV_NU7_FALLBACK: &str = "KAKURE_NU7_PARAMS_FALLBACK";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Params {
    base: consensus::Network,
    /// NU7 height used only when `base` has none (the fallback).
    nu7_fallback: Option<BlockHeight>,
}

impl Parameters for Params {
    fn network_type(&self) -> NetworkType {
        self.base.network_type()
    }

    fn activation_height(&self, nu: NetworkUpgrade) -> Option<BlockHeight> {
        match (nu, self.base.activation_height(nu)) {
            (NetworkUpgrade::Nu7, None) => self.nu7_fallback,
            (_, height) => height,
        }
    }
}

/// What the operator knows about NU7 on this network.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Nu7 {
    /// The crate (or the configured fallback) knows the height: transactions are NU7-correct.
    Known(BlockHeight),
    /// ZIP 259 published a height the build does not know: pause payouts before it.
    UnknownToBuild(BlockHeight),
    /// No height anywhere yet.
    Unset,
}

fn env_height() -> Result<Option<BlockHeight>> {
    match std::env::var(ENV_NU7_HEIGHT) {
        Ok(v) if !v.trim().is_empty() => {
            Ok(Some(BlockHeight::from_u32(v.trim().parse().with_context(
                || format!("{ENV_NU7_HEIGHT} must be a block height"),
            )?)))
        }
        _ => Ok(None),
    }
}

fn fallback_enabled() -> bool {
    std::env::var(ENV_NU7_FALLBACK).is_ok_and(|v| v == "1")
}

impl Params {
    pub fn new(base: consensus::Network) -> Result<Self> {
        let crate_height = base.activation_height(NetworkUpgrade::Nu7);
        let configured = env_height()?;
        let nu7_fallback = match (crate_height, configured) {
            (Some(known), Some(env)) if known != env => {
                bail!("{ENV_NU7_HEIGHT}={env} disagrees with the build's NU7 height {known}")
            }
            (None, Some(env)) if fallback_enabled() => Some(env),
            _ => None,
        };
        Ok(Self { base, nu7_fallback })
    }

    pub fn nu7(&self) -> Result<Nu7> {
        Ok(
            match (self.activation_height(NetworkUpgrade::Nu7), env_height()?) {
                (Some(h), _) => Nu7::Known(h),
                (None, Some(h)) => Nu7::UnknownToBuild(h),
                (None, None) => Nu7::Unset,
            },
        )
    }

    /// `Some(reason)` when payouts must not be built at `tip`.
    pub fn payout_pause(&self, tip: BlockHeight) -> Result<Option<String>> {
        Ok(match self.nu7()? {
            Nu7::UnknownToBuild(h) if tip + NU7_PAUSE_MARGIN_BLOCKS >= h => Some(format!(
                "NU7 activates at {h} and this build does not know it: payouts paused from {} \
                 (set {ENV_NU7_FALLBACK}=1 or upgrade the crates)",
                h - NU7_PAUSE_MARGIN_BLOCKS
            )),
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_only_fills_a_missing_height() {
        let main = Params {
            base: consensus::Network::MainNetwork,
            nu7_fallback: Some(BlockHeight::from_u32(3_600_000)),
        };
        assert_eq!(
            main.activation_height(NetworkUpgrade::Nu7),
            Some(BlockHeight::from_u32(3_600_000))
        );
        let test = Params {
            base: consensus::Network::TestNetwork,
            nu7_fallback: Some(BlockHeight::from_u32(1)),
        };
        assert_eq!(
            test.activation_height(NetworkUpgrade::Nu7),
            Some(BlockHeight::from_u32(4_465_026))
        );
    }
}
