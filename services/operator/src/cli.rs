//! Command-line interface.

use std::path::PathBuf;

use anyhow::{Context, Result, anyhow};
use clap::{Args, Parser, Subcommand};
use zcash_client_backend::data_api::AccountBirthday;
use zcash_protocol::consensus::BlockHeight;

use crate::{
    remote::{self, Server, Tor},
    scan::{self, SyncOpts},
    send,
    wallet::{self, Net, Wallet},
};

#[derive(Parser)]
#[command(
    name = "kakure-operator",
    version,
    about = "Kakure operator wallet (Zcash, Tor-only)"
)]
pub struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Args)]
struct Common {
    /// Network: testnet or mainnet.
    #[arg(long, value_enum)]
    network: Net,

    /// Wallet data directory (default: operator-data/<network>).
    #[arg(long)]
    data_dir: Option<PathBuf>,

    /// Light-wallet server host:port (default: testnet.zec.rocks:443 / zec.rocks:443).
    #[arg(long)]
    server: Option<String>,
}

impl Common {
    fn wallet(&self) -> Wallet {
        Wallet::new(self.network, self.data_dir.clone())
    }

    async fn tor(&self, wallet: &Wallet) -> Result<Tor> {
        let server = match &self.server {
            Some(s) => Server::parse(s)?,
            None => Server::default_for(self.network),
        };
        Tor::bootstrap(&wallet.tor_dir(), server).await
    }
}

#[derive(Subcommand)]
enum Command {
    /// Create a wallet (new mnemonic, birthday at the current tip), or restore one.
    Init {
        #[command(flatten)]
        common: Common,
        /// Restore from the mnemonic stored in this file instead of generating one.
        #[arg(long)]
        restore_from: Option<PathBuf>,
        /// Birthday height (default: the current chain tip).
        #[arg(long)]
        birthday: Option<u32>,
    },
    /// Derive Orchard-only diversified Unified Addresses.
    Addresses {
        #[command(flatten)]
        common: Common,
        #[arg(long, default_value_t = 1)]
        count: u32,
        /// First diversifier index. Index 0 is taken by the default Orchard+Sapling address
        /// that `create_account` exposes, so Orchard-only market addresses start at 1.
        #[arg(long, default_value_t = 1, value_parser = clap::value_parser!(u32).range(1..))]
        start: u32,
    },
    /// Scan to the tip, fetching every shielded transaction of every block over Tor.
    Sync {
        #[command(flatten)]
        common: Common,
        /// Concurrent full-transaction circuits.
        #[arg(long, default_value_t = 4)]
        parallel: usize,
        /// Blocks whose transactions share one isolated circuit.
        #[arg(long, default_value_t = 8)]
        blocks_per_circuit: usize,
    },
    /// Spendable balance per pool.
    Balance {
        #[command(flatten)]
        common: Common,
    },
    /// Received notes with their memos.
    Memos {
        #[command(flatten)]
        common: Common,
    },
    /// Every output the wallet knows, per transaction (received, change, sent).
    Outputs {
        #[command(flatten)]
        common: Common,
        /// Only this txid (display hex).
        #[arg(long)]
        txid: Option<String>,
    },
    /// Send Orchard-family funds with a memo (OvkPolicy::Discard, ZIP 317 fee) over Tor.
    Send {
        #[command(flatten)]
        common: Common,
        #[arg(long)]
        to: String,
        #[arg(long)]
        zat: u64,
        #[arg(long)]
        memo: String,
    },
}

impl Cli {
    pub async fn run(self) -> Result<()> {
        match self.command {
            Command::Init {
                common,
                restore_from,
                birthday,
            } => {
                let wallet = common.wallet();
                anyhow::ensure!(
                    !wallet.exists(),
                    "{} already holds a wallet",
                    wallet.dir.display()
                );
                let phrase = restore_from
                    .as_deref()
                    .map(wallet::read_phrase)
                    .transpose()?;
                let tor = common.tor(&wallet).await?;
                let mut lwd = tor.circuit().await?;
                let tip = remote::latest_height(&mut lwd).await?;
                let height = birthday.map_or(tip, BlockHeight::from_u32);
                // The birthday is defined by the tree state of the block before it.
                let treestate = remote::tree_state(&mut lwd, height - 1).await?;
                let recover_until = phrase.is_some().then_some(tip);
                let birthday = AccountBirthday::from_treestate(treestate, recover_until)
                    .map_err(|e| anyhow!("birthday: {e:?}"))?;
                wallet.create(phrase, &birthday)?;
                println!(
                    "{} wallet {} in {} (birthday {height}, tip {tip}); mnemonic stored 0600",
                    common.network.name(),
                    if restore_from.is_some() {
                        "restored"
                    } else {
                        "created"
                    },
                    wallet.dir.display()
                );
            }
            Command::Addresses {
                common,
                count,
                start,
            } => {
                let wallet = common.wallet();
                let mut db = wallet.open()?;
                let addrs = wallet::addresses(&mut db, common.network, start, count)?;
                for (j, ua) in &addrs {
                    println!("{j}\t{ua}");
                }
                println!(
                    "ivk check: all {} addresses are Orchard-only and the account's single Orchard IVK recovers each diversifier index",
                    addrs.len()
                );
            }
            Command::Sync {
                common,
                parallel,
                blocks_per_circuit,
            } => {
                let wallet = common.wallet();
                wallet.open()?;
                let tor = common.tor(&wallet).await?;
                scan::sync(
                    &wallet,
                    &tor,
                    &SyncOpts {
                        parallel,
                        blocks_per_circuit,
                    },
                )
                .await?;
            }
            Command::Balance { common } => {
                wallet::print_balance(&common.wallet().open()?)?;
            }
            Command::Memos { common } => {
                let wallet = common.wallet();
                wallet.open()?;
                for o in wallet::outputs(&wallet)?
                    .into_iter()
                    .filter(|o| o.to_us && !o.is_change)
                {
                    println!(
                        "height {}  {:<8} {:>10} zat  div {}  to {}  memo {}",
                        o.height.map_or("unmined".into(), |h| h.to_string()),
                        o.pool,
                        o.value,
                        o.diversifier_index.map_or("?".into(), |d| d.to_string()),
                        o.to_address.as_deref().unwrap_or("?"),
                        o.memo.as_deref().map_or("-".into(), |m| format!("{m:?}")),
                    );
                }
            }
            Command::Outputs { common, txid } => {
                let wallet = common.wallet();
                wallet.open()?;
                let rows = wallet::outputs(&wallet)?;
                let rows = rows
                    .iter()
                    .filter(|o| txid.as_deref().is_none_or(|t| o.txid == t));
                for o in rows {
                    let kind = match (o.from_us, o.to_us, o.is_change) {
                        (_, true, true) => "change",
                        (_, true, false) => "received",
                        (true, false, _) => "sent",
                        _ => "other",
                    };
                    println!(
                        "{}  height {}  {:<8} #{:<2} {:<8} {:>10} zat  to {}  memo {}",
                        o.txid,
                        o.height.map_or("unmined".into(), |h| h.to_string()),
                        o.pool,
                        o.index,
                        kind,
                        o.value,
                        o.to_address.as_deref().unwrap_or("(unknown)"),
                        o.memo.as_deref().map_or("-".into(), |m| format!("{m:?}")),
                    );
                }
            }
            Command::Send {
                common,
                to,
                zat,
                memo,
            } => {
                let wallet = common.wallet();
                wallet.open()?;
                let tor = common.tor(&wallet).await?;
                let txid = send::send(&wallet, &tor, &to, zat, &memo)
                    .await
                    .context("send failed")?;
                println!("{txid}");
            }
        }
        Ok(())
    }
}
