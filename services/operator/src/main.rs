//! Kakure operator: the market wallet on librustzcash (Tor-only chain access), the catalog,
//! ingest, engine and the signed bundle publisher.

mod catalog;
mod cli;
// Shared formats (S01). Payout maths is used from S03.
#[allow(dead_code)]
mod domain;
mod engine;
mod history;
mod ingest;
mod lifecycle;
mod params;
mod payouts;
mod publish;
mod push;
mod release;
mod remote;
mod resolve;
mod scan;
mod send;
mod signing;
mod store;
mod venues;
mod wallet;

use clap::Parser;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        // Arti logs every failed relay dial at WARN during bootstrap; keep those quiet.
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("warn,tor_chanmgr=error,tor_guardmgr=error")),
        )
        .with_writer(std::io::stderr)
        .init();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("a rustls crypto provider was already installed"))?;
    cli::Cli::parse().run().await
}
