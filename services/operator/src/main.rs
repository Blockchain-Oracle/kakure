//! Kakure operator: the market wallet on librustzcash (Tor-only chain access), the real-time
//! market (`serve`, plan §00) and the pool engine it replaces (`run`), and the signed publisher.

mod api;
mod catalog;
mod cli;
// Shared formats (S01). Payout maths is used from S03.
#[allow(dead_code)]
mod domain;
mod engine;
mod fair;
mod gateway;
mod history;
mod ingest;
mod lanes;
mod lifecycle;
mod minutes;
mod params;
mod payouts;
mod publish;
mod push;
mod realtime;
mod release;
mod remote;
mod resolve;
mod rt_store;
mod scan;
mod send;
mod settle;
mod sigma;
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
