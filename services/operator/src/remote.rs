//! Public light-wallet servers, reached only through Tor.
//!
//! Every request group gets its own isolated Tor circuit (`tor::Client::isolated_client`),
//! so the server cannot link one group (chain metadata, a batch of compact blocks, a chunk
//! of full transactions, a broadcast) to another by circuit.

use std::{
    os::unix::fs::PermissionsExt,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
use tonic::transport::{Channel, Uri};
use zcash_client_backend::{
    proto::service::{
        BlockId, ChainSpec, TreeState, compact_tx_streamer_client::CompactTxStreamerClient,
    },
    tor,
};
use zcash_protocol::consensus::BlockHeight;

use crate::wallet::Net;

pub type Lwd = CompactTxStreamerClient<Channel>;

/// Fresh isolated circuits tried before a connection is reported as failed.
const CIRCUIT_ATTEMPTS: u32 = 3;

/// A lightwalletd-protocol server (gRPC over TLS).
#[derive(Clone, Debug)]
pub struct Server {
    host: String,
    port: u16,
}

impl Server {
    /// The default public server per network (research §4: `testnet.zec.rocks` is the
    /// only testnet server that answered; `zec.rocks` is the Zodl mainnet default).
    pub fn default_for(net: Net) -> Self {
        match net {
            Net::Testnet => Self {
                host: "testnet.zec.rocks".into(),
                port: 443,
            },
            Net::Mainnet => Self {
                host: "zec.rocks".into(),
                port: 443,
            },
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        let (host, port) = s
            .rsplit_once(':')
            .ok_or_else(|| anyhow!("server must be host:port, got {s}"))?;
        if host.ends_with(".onion") {
            return Err(anyhow!("onion servers are not enabled in this build"));
        }
        Ok(Self {
            host: host.to_string(),
            port: port.parse().context("server port")?,
        })
    }

    fn uri(&self) -> Result<Uri> {
        Ok(format!("https://{}:{}", self.host, self.port).parse()?)
    }
}

impl std::fmt::Display for Server {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.host, self.port)
    }
}

#[derive(Default)]
struct CircuitStats {
    count: u32,
    total: Duration,
    max: Duration,
}

/// A bootstrapped Tor client plus circuit timing.
pub struct Tor {
    client: tor::Client,
    server: Server,
    bootstrap: Duration,
    stats: Mutex<CircuitStats>,
}

impl Tor {
    /// Bootstraps Tor with its state in `dir` (created 0700 if missing).
    pub async fn bootstrap(dir: &Path, server: Server) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        let t0 = Instant::now();
        let client = tor::Client::create(dir, |_| {})
            .await
            .context("Tor bootstrap failed")?;
        let bootstrap = t0.elapsed();
        eprintln!("tor: bootstrapped in {:.1}s", bootstrap.as_secs_f64());
        Ok(Self {
            client,
            server,
            bootstrap,
            stats: Mutex::default(),
        })
    }

    /// Opens a gRPC channel to the server over a fresh, isolated Tor circuit.
    ///
    /// A failed attempt (for example an exit that cannot resolve the host) is retried on
    /// another fresh isolated circuit, up to `CIRCUIT_ATTEMPTS` times.
    pub async fn circuit(&self) -> Result<Lwd> {
        let server = self.server.clone();
        self.circuit_to(&server).await
    }

    /// The configured server.
    pub fn server(&self) -> &Server {
        &self.server
    }

    /// As `circuit`, to another server (independent cross-checks).
    pub async fn circuit_to(&self, server: &Server) -> Result<Lwd> {
        let t0 = Instant::now();
        let mut attempt = 1;
        let lwd = loop {
            let isolated = self.client.isolated_client();
            match isolated.connect_to_lightwalletd(server.uri()?, false).await {
                Ok(lwd) => break lwd,
                Err(e) if attempt < CIRCUIT_ATTEMPTS => {
                    eprintln!("tor: circuit attempt {attempt} failed ({e}); retrying");
                    attempt += 1;
                }
                Err(e) => {
                    return Err(anyhow::Error::new(e).context(format!(
                        "connecting to {server} over Tor ({attempt} attempts)"
                    )));
                }
            }
        };
        let took = t0.elapsed();
        let mut s = self.stats.lock().expect("stats lock");
        s.count += 1;
        s.total += took;
        s.max = s.max.max(took);
        Ok(lwd)
    }

    /// One line of Tor timings for the run.
    pub fn report(&self) {
        let s = self.stats.lock().expect("stats lock");
        let avg = if s.count == 0 {
            0.0
        } else {
            s.total.as_secs_f64() / f64::from(s.count)
        };
        eprintln!(
            "tor: bootstrap {:.1}s; {} isolated circuits, connect avg {:.2}s, max {:.2}s",
            self.bootstrap.as_secs_f64(),
            s.count,
            avg,
            s.max.as_secs_f64()
        );
    }
}

pub async fn latest_height(lwd: &mut Lwd) -> Result<BlockHeight> {
    let latest = lwd
        .get_latest_block(ChainSpec::default())
        .await?
        .into_inner();
    Ok(BlockHeight::from_u32(u32::try_from(latest.height)?))
}

pub async fn tree_state(lwd: &mut Lwd, height: BlockHeight) -> Result<TreeState> {
    let req = BlockId {
        height: u64::from(height),
        hash: vec![],
    };
    Ok(lwd.get_tree_state(req).await?.into_inner())
}
