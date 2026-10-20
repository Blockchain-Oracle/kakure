//! Command-line interface.

use std::{
    fs,
    io::Write as _,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result, anyhow, ensure};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use clap::{Args, Parser, Subcommand};
use rand::{TryRng as _, rngs::SysRng};
use zcash_client_backend::data_api::AccountBirthday;
use zcash_protocol::consensus::BlockHeight;

use crate::{
    api, catalog,
    chain::{self, Chain},
    deposits,
    domain::{self, BATCH_INTERVAL_SECS, BetMemo, NONCE_BYTES},
    engine::{self, Engine, TICK_OFFSET_SECS},
    gateway::Gateway,
    mint::Mint,
    minutes::MINUTE_SECS,
    payouts,
    realtime::{self, Realtime},
    remote::{self, Server, Tor},
    scan::{self, SyncOpts},
    send, signing,
    store::Store,
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

    /// Server transactions are broadcast to (default: the other mainnet server, us.zec.stardust.rest:443
    /// or zec.rocks:443; on testnet the sync server, the only one).
    #[arg(long)]
    broadcast_server: Option<String>,
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
        let broadcast = match &self.broadcast_server {
            Some(s) => Server::parse(s)?,
            None => Server::broadcast_for(self.network, &server)?,
        };
        Tor::bootstrap(&wallet.tor_dir(), server, broadcast).await
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
    /// Create the operator's Ed25519 signing key (signing.key, mode 0600). Never overwrites.
    Keygen {
        #[command(flatten)]
        common: Common,
    },
    /// Print the signing public key (hex and base64url) for clients to pin.
    Pubkey {
        #[command(flatten)]
        common: Common,
    },
    /// The real-time market (plan §00 REVAMP 2): every venue's 1-minute closes, Window prints and
    /// settlement, σ, hourly prints files and a signed bundle every minute.
    Serve {
        #[command(flatten)]
        common: Common,
        /// Run one minute's work and exit (no gateway, no chain).
        #[arg(long)]
        once: bool,
        #[arg(long, default_value_t = 4)]
        parallel: usize,
        #[arg(long, default_value_t = 8)]
        blocks_per_circuit: usize,
    },
    /// The operator loop: sync → ingest → engine → publish, on a fixed UTC-aligned clock.
    Run {
        #[command(flatten)]
        common: Common,
        /// Seconds between ticks (ticks align to multiples of this, plus a short offset).
        #[arg(long, default_value_t = BATCH_INTERVAL_SECS)]
        interval_secs: u64,
        /// Run one tick and exit.
        #[arg(long)]
        once: bool,
        /// Skip the chain sync (publish from the wallet as it is).
        #[arg(long)]
        no_sync: bool,
        /// List no new markets; finish the open ones (resolve, refund, pay) before the cut-over to `serve`.
        #[arg(long)]
        drain: bool,
        #[arg(long, default_value_t = 4)]
        parallel: usize,
        #[arg(long, default_value_t = 8)]
        blocks_per_circuit: usize,
    },
    /// Testnet only: create an extra "testnet reaches height H before T" event market now
    /// (rules fixed at creation; opens at the next tick).
    Event {
        #[command(flatten)]
        common: Common,
        /// H = the scanned tip + this many blocks.
        #[arg(long, default_value_t = catalog::TESTNET_EVENT_BLOCKS_AHEAD)]
        blocks_ahead: u32,
        /// T = now + this many seconds (rounded up to the tick).
        #[arg(long, default_value_t = catalog::TESTNET_EVENT_DURATION_SECS)]
        duration_secs: i64,
    },
    /// Re-send a stored, unmined, unexpired transaction of this wallet over Tor.
    Rebroadcast {
        #[command(flatten)]
        common: Common,
        /// Display txid (hex).
        #[arg(long)]
        txid: String,
    },
    /// Read the consensus branch ID from a block's coinbase (the NU7 resolver's chain read).
    BranchId {
        #[command(flatten)]
        common: Common,
        #[arg(long)]
        height: u32,
    },
    /// Markets, receipts and publication state from engine.sqlite.
    Status {
        #[command(flatten)]
        common: Common,
    },
    /// Bettor helper: build a bet memo with `encode_bet_memo` and send it from this wallet.
    /// The nonce is kept in <data-dir>/bets.jsonl (0600) for the receipt.
    Bet {
        #[command(flatten)]
        common: Common,
        /// Market address; or use --list to pick one at random from a published address list.
        #[arg(long, conflicts_with = "list", required_unless_present = "list")]
        to: Option<String>,
        /// A published addresses-<hash8>.json.
        #[arg(long)]
        list: Option<PathBuf>,
        #[arg(long)]
        market: String,
        /// U or D (close markets), Y or N (event markets).
        #[arg(long)]
        side: String,
        /// Ticket size in zatoshi (1000000 = 0.01).
        #[arg(long)]
        zat: u64,
        /// Payout Unified Address (must contain an Orchard receiver).
        #[arg(long)]
        payout: String,
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
        // Fail fast on a bad NU7 configuration (KAKURE_NU7_*), before any wallet work.
        for net in [Net::Testnet, Net::Mainnet] {
            crate::params::Params::new(net.base())?;
        }
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
            Command::Keygen { common } => {
                let wallet = common.wallet();
                let key = signing::keygen(&wallet.dir)?;
                print_pubkey(&key.public());
                eprintln!(
                    "signing key stored 0600 in {}",
                    signing::key_path(&wallet.dir).display()
                );
            }
            Command::Pubkey { common } => {
                print_pubkey(&signing::load(&common.wallet().dir)?.public());
            }
            Command::Serve {
                common,
                once,
                parallel,
                blocks_per_circuit,
            } => {
                let wallet = common.wallet();
                let mut rt = Realtime::open(&wallet)?;
                eprintln!("serve: publishing to {}", rt.public_dir().display());
                if once {
                    minute_loop(&mut rt, true).await;
                } else {
                    let sync = SyncOpts {
                        parallel,
                        blocks_per_circuit,
                    };
                    match start_trading(&common, &wallet, &mut rt, sync).await? {
                        // The chain task holds SQLite across awaits, so it shares this task with
                        // the minute loop instead of being spawned onto another thread.
                        Some(chain) => {
                            tokio::join!(minute_loop(&mut rt, false), chain.run());
                        }
                        None => minute_loop(&mut rt, false).await,
                    }
                }
            }
            Command::Run {
                common,
                interval_secs,
                once,
                no_sync,
                drain,
                parallel,
                blocks_per_circuit,
            } => {
                ensure!(interval_secs >= 10, "--interval-secs must be at least 10");
                let interval = i64::try_from(interval_secs)?;
                let mut engine = Engine::open(common.wallet(), interval)?;
                engine.drain = drain;
                if drain {
                    eprintln!(
                        "run: draining: no new markets; the open ones finish, then switch to `serve`"
                    );
                }
                let tor = if no_sync {
                    None
                } else {
                    Some(common.tor(&engine.wallet).await?)
                };
                let opts = SyncOpts {
                    parallel,
                    blocks_per_circuit,
                };
                eprintln!("run: publishing to {}", engine.public_dir().display());
                let offset = TICK_OFFSET_SECS.min(interval / 4);
                let mut synced = false;
                let mut last_wake = 0;
                loop {
                    if !once {
                        // Bundles only ever go out on the aligned clock: after a restart, a host
                        // sleep or a wake that ran long, the loop waits for the next aligned slot
                        // rather than publish late (O10).
                        let aligned =
                            |now: i64| catalog::next_window_start(now - offset, interval) + offset;
                        let mut next = aligned(chrono::Utc::now().timestamp());
                        loop {
                            let now = chrono::Utc::now().timestamp();
                            if now > next + engine::LATE_TICK_SLACK_SECS {
                                eprintln!(
                                    "run: woke too late for the {} tick; waiting for the next aligned one",
                                    catalog::iso(next)
                                );
                                next = aligned(now);
                                continue;
                            }
                            if now >= next {
                                break;
                            }
                            // Sends go out at their own random times, never right after a sync (O6),
                            // only once a tick of this run has synced the wallet, and never in the
                            // last moments before a tick.
                            let due = match &tor {
                                Some(_) if synced => engine
                                    .next_send(now)?
                                    .filter(|d| *d < next - engine::SEND_GUARD_SECS),
                                _ => None,
                            };
                            let wake = due.map_or(next, |d| {
                                d.max(now)
                                    .max(last_wake + engine::MIN_WAKE_GAP_SECS)
                                    .min(next)
                            });
                            tokio::time::sleep(Duration::from_secs(u64::try_from(
                                (wake - now).max(0),
                            )?))
                            .await;
                            if wake >= next {
                                continue;
                            }
                            last_wake = chrono::Utc::now().timestamp();
                            if let Some(tor) = &tor {
                                match engine.payout_wake(tor, &opts, next).await {
                                    Ok(n) if n > 0 => eprintln!("payouts: sent {n} transaction(s)"),
                                    Ok(_) => {}
                                    Err(e) => eprintln!("payouts: wake failed: {e:#}"),
                                }
                            }
                        }
                    }
                    match engine.tick(tor.as_ref(), &opts).await {
                        Ok(r) => {
                            println!(
                                "{} tick: bundle-{}.json, tip {}, {} markets, {} tickets, {} receipts, {}{}",
                                catalog::iso(chrono::Utc::now().timestamp()),
                                r.seq,
                                r.tip,
                                r.markets,
                                r.tickets,
                                r.receipts,
                                r.addresses,
                                r.uploaded
                                    .map_or(String::new(), |n| format!(", {n} file(s) pushed")),
                            );
                            if drain {
                                drain_report(&engine, r.unresolved);
                            }
                        }
                        Err(e) => eprintln!("tick failed: {e:#}"),
                    }
                    synced = true;
                    // Whatever came due while the tick ran gets its own random time (O6).
                    match payouts::spread_overdue(&engine.store, chrono::Utc::now().timestamp()) {
                        Ok(n) if n > 0 => {
                            eprintln!(
                                "payouts: {n} late send(s) given random times in this interval"
                            )
                        }
                        Ok(_) => {}
                        Err(e) => eprintln!("payouts: spreading late sends failed: {e:#}"),
                    }
                    if once {
                        break;
                    }
                }
            }
            Command::Status { common } => status(&common.wallet())?,
            Command::Event {
                common,
                blocks_ahead,
                duration_secs,
            } => {
                ensure!(
                    common.network == Net::Testnet,
                    "extra height events are a testnet tool"
                );
                let wallet = common.wallet();
                let tip = crate::ingest::BlockTimes::load(&wallet)?
                    .tip()
                    .context("sync first")?;
                let tick = i64::try_from(BATCH_INTERVAL_SECS)?;
                let now = chrono::Utc::now().timestamp();
                let opens_at = catalog::next_window_start(now, tick);
                let market = catalog::testnet_height_market(
                    opens_at,
                    catalog::next_window_start(now + duration_secs, tick),
                    tip + blocks_ahead,
                    payouts::window(common.network)?,
                )?;
                let mut store = Store::open(&wallet.dir.join("engine.sqlite"))?;
                let tx = store.conn.transaction()?;
                ensure!(
                    crate::store::insert_market(&tx, &market, now)?,
                    "{} already exists",
                    market.id
                );
                tx.commit()?;
                println!(
                    "{}: height {} before {} (opens {})",
                    market.id,
                    tip + blocks_ahead,
                    catalog::iso(market.closes_at),
                    catalog::iso(market.opens_at)
                );
            }
            Command::Rebroadcast { common, txid } => {
                use zcash_client_backend::data_api::WalletRead as _;
                let wallet = common.wallet();
                let db = wallet.open()?;
                let mut bytes: [u8; 32] = hex::decode(&txid)?
                    .try_into()
                    .map_err(|_| anyhow!("txid must be 32 bytes"))?;
                bytes.reverse();
                let tx = db
                    .get_transaction(zcash_protocol::TxId::from_bytes(bytes))?
                    .ok_or_else(|| anyhow!("{txid} is not in this wallet"))?;
                let mut raw = vec![];
                tx.write(&mut raw)?;
                drop(db);
                let tor = common.tor(&wallet).await?;
                send::broadcast(&tor, &raw).await?;
                println!("rebroadcast {txid} (expiry height {})", tx.expiry_height());
            }
            Command::BranchId { common, height } => {
                let wallet = common.wallet();
                let tor = common.tor(&wallet).await?;
                let mut lwd = tor.circuit().await?;
                let branch = crate::resolve::coinbase_branch(&mut lwd, height).await?;
                println!("block {height}: coinbase nConsensusBranchId 0x{branch:08X}");
            }
            Command::Bet {
                common,
                to,
                list,
                market,
                side,
                zat,
                payout,
            } => {
                let wallet = common.wallet();
                wallet.open()?;
                let to = match (to, list) {
                    (Some(to), _) => to,
                    (None, Some(list)) => random_address(&list)?,
                    (None, None) => unreachable!("clap requires --to or --list"),
                };
                let mut nonce = [0u8; NONCE_BYTES];
                SysRng
                    .try_fill_bytes(&mut nonce)
                    .map_err(|e| anyhow!("system RNG: {e}"))?;
                let bet = BetMemo {
                    network: engine::domain_network(common.network),
                    market_id: market,
                    side,
                    size_zat: zat,
                    nonce,
                    payout_address: payout,
                };
                let memo = domain::encode_bet_memo(&bet)?;
                let leaf = hex::encode(domain::ticket_hash(&bet));
                let tor = common.tor(&wallet).await?;
                // A stale wallet builds a transaction that expires before it reaches the chain.
                scan::sync(
                    &wallet,
                    &tor,
                    &SyncOpts {
                        parallel: 4,
                        blocks_per_circuit: 8,
                    },
                )
                .await?;
                let txid = send::send(&wallet, &tor, &to, zat, &memo)
                    .await
                    .context("send failed")?;
                record_bet(&wallet.dir, &txid.to_string(), &bet, &leaf, &to)?;
                println!("txid {txid}");
                println!("leaf {leaf}");
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
                // A stale wallet builds a transaction that expires before it reaches the chain.
                scan::sync(
                    &wallet,
                    &tor,
                    &SyncOpts {
                        parallel: 4,
                        blocks_per_circuit: 8,
                    },
                )
                .await?;
                let txid = send::send(&wallet, &tor, &to, zat, &memo)
                    .await
                    .context("send failed")?;
                println!("{txid}");
            }
        }
        Ok(())
    }
}

fn print_pubkey(public: &[u8; 32]) {
    println!("hex       {}", hex::encode(public));
    println!("base64url {}", URL_SAFE_NO_PAD.encode(public));
}

fn random_address(list: &Path) -> Result<String> {
    let doc: serde_json::Value = serde_json::from_slice(&fs::read(list)?)?;
    let addresses = doc["addresses"]
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or_else(|| anyhow!("{} has no addresses", list.display()))?;
    let mut bytes = [0u8; 8];
    SysRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| anyhow!("system RNG: {e}"))?;
    let pick = usize::try_from(u64::from_le_bytes(bytes) % addresses.len() as u64)?;
    addresses[pick]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("address is not a string"))
}

/// The bettor's local record (the nonce is what proves the ticket later).
fn record_bet(dir: &Path, txid: &str, bet: &BetMemo, leaf: &str, to: &str) -> Result<()> {
    let line = serde_json::json!({
        "txid": txid,
        "market": bet.market_id,
        "side": bet.side,
        "sizeZat": bet.size_zat.to_string(),
        "nonce": URL_SAFE_NO_PAD.encode(bet.nonce),
        "payout": bet.payout_address,
        "to": to,
        "leaf": leaf,
    });
    let mut file = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .open(dir.join("bets.jsonl"))?;
    writeln!(file, "{line}")?;
    Ok(())
}

/// One line per tick while draining: how many pool markets are still open and what payouts remain. `serve`
/// sends every scheduled payout, so the cut-over can go once no market is open.
fn drain_report(engine: &Engine, unresolved: usize) {
    let payouts = payouts::summary(&engine.store, chrono::Utc::now().timestamp())
        .map(|lines| lines.join("; "))
        .unwrap_or_else(|e| format!("payouts unreadable: {e:#}"));
    if unresolved == 0 {
        eprintln!("drain: every pool market is resolved; switch to `serve` ({payouts})");
    } else {
        eprintln!("drain: {unresolved} pool market(s) still open ({payouts})");
    }
}

fn status(wallet: &Wallet) -> Result<()> {
    let store = Store::open(&wallet.dir.join("engine.sqlite"))?;
    let now = chrono::Utc::now().timestamp();
    if let Ok(key) = signing::load(&wallet.dir) {
        println!("pubkey    {}", hex::encode(key.public()));
    }
    match store.last_bundle()? {
        Some((seq, file, hash)) => println!("bundle    {file} (seq {seq}, sha256 {hash})"),
        None => println!("bundle    none yet"),
    }
    if let Some((seq, file)) = store.current_address_list()? {
        println!("addresses {file} (list {seq})");
    }
    for m in store.markets()? {
        if m.closes_at < now - engine::BUNDLE_RETENTION_SECS {
            continue;
        }
        let tickets = store.tickets(&m.id)?;
        let released = store.released(&m.id)?.len();
        let phase = if let Some(outcome) = &m.outcome {
            if outcome == "refund" {
                "resolved: refund"
            } else {
                "resolved"
            }
        } else if m.cancelled {
            "cancelled"
        } else if m.cutoff_hash.is_some() {
            "frozen"
        } else if now < m.opens_at {
            "scheduled"
        } else if now < m.cutoff_at {
            if m.kind == "close" && m.opening.is_none() {
                "awaiting opening"
            } else {
                "open"
            }
        } else {
            "closed"
        };
        println!(
            "{:<26} {:<16} tickets {:>3} ({:>3} released)  opens {}  cutoff {}{}{}",
            m.id,
            phase,
            tickets.len(),
            released,
            catalog::iso(m.opens_at),
            catalog::iso(m.cutoff_at),
            m.cutoff_height
                .map_or(String::new(), |h| format!("  H_c {h}")),
            m.opening
                .as_deref()
                .map_or(String::new(), |o| format!("  opening {o}")),
        );
        if let Some(h) = m.target_height {
            println!("{:<26} target height {h}", "");
        }
        if let (Some(outcome), Some(reason)) = (&m.outcome, &m.outcome_reason) {
            println!(
                "{:<26} resolved {} → {outcome} ({reason})",
                "",
                m.resolved_at.map(catalog::iso).unwrap_or_default()
            );
        }
    }
    for line in payouts::summary(&store, now)? {
        println!("{line}");
    }
    for (status, reason, count) in store.receipt_counts()? {
        println!(
            "receipts  {status}{}: {count}",
            reason.map_or(String::new(), |r| format!(" ({r})"))
        );
    }
    Ok(())
}

/// Starts the trading side of `serve` (plan §00): the mint and its Oblivious HTTP gateway, and,
/// when the data directory has a wallet, the chain task (deposits, withdrawals) and the deposit
/// address. What clients need to trade goes into every signed bundle.
async fn start_trading(
    common: &Common,
    wallet: &Wallet,
    rt: &mut Realtime,
    sync: SyncOpts,
) -> Result<Option<Chain>> {
    let mut chain = None;
    let gateway = std::sync::Arc::new(Gateway::load(&wallet.dir, chrono::Utc::now().timestamp())?);
    let mint = Mint::load(&wallet.dir)?;
    let mainnet = matches!(wallet.net, Net::Mainnet);
    let confirmations = deposits::confirmations(mainnet);
    let tip = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let mut trading = serde_json::json!({
        "keyset": mint.keyset_json(),
        "retiredKeysets": mint.retired_json(),
        "depositMemoPrefix": deposits::DEPOSIT_MEMO_PREFIX,
        "depositConfirmations": confirmations,
        "minWithdrawZat": api::MIN_WITHDRAW_ZAT.to_string(),
        "withdrawWithinSecs": api::WITHDRAW_WINDOW.max,
    });
    if wallet.exists() {
        let mut db = wallet.open()?;
        let (_, address) = wallet::addresses(&mut db, wallet.net, chain::DEPOSIT_ADDRESS_INDEX, 1)?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("no deposit address"))?;
        trading["depositAddress"] = serde_json::Value::String(address);
        let tor = common.tor(wallet).await?;
        chain = Some(Chain {
            wallet: common.wallet(),
            store: Store::open(&wallet.dir.join("engine.sqlite"))?,
            tor,
            sync,
            tip: tip.clone(),
            short_reported: 0,
        });
    } else {
        eprintln!(
            "serve: no wallet in {}: deposits and withdrawals are off",
            wallet.dir.display()
        );
    }
    // The bundle adds the gateway's current key each minute (`gatewayKeys`), as it rotates.
    rt.set_trading(trading, gateway.clone());
    let api = api::Api {
        gateway,
        mint,
        store: std::sync::Mutex::new(Store::open(&wallet.dir.join("engine.sqlite"))?),
        tip,
        network: engine::domain_network(wallet.net),
        network_name: wallet.net.name(),
        confirmations,
        prices: crate::prices::Prices::spawn(),
        key: crate::signing::load(&wallet.dir)?,
        sigma: rt.sigma_map(),
        caps: rt.caps(),
    };
    tokio::spawn(async move {
        if let Err(e) = api::serve(api).await {
            eprintln!("gateway: stopped: {e:#}");
        }
    });
    Ok(chain)
}

/// The one-minute clock: the minute's work starts `TICK_OFFSET` into each minute, once venues have
/// committed the minute that just ended.
async fn minute_loop(rt: &mut Realtime, once: bool) {
    loop {
        if !once {
            let now = chrono::Utc::now().timestamp();
            let next = (now - realtime::TICK_OFFSET_SECS).div_euclid(MINUTE_SECS) * MINUTE_SECS
                + MINUTE_SECS
                + realtime::TICK_OFFSET_SECS;
            tokio::time::sleep(Duration::from_secs(u64::try_from(next - now).unwrap_or(0))).await;
        }
        let now = chrono::Utc::now().timestamp();
        match rt.tick(now).await {
            Ok(r) => println!(
                "{} serve: bundle-{}.json, {} minutes, {} opened, {} settled, {} windows, {} prints{}",
                catalog::iso(now),
                r.seq,
                r.minutes,
                r.opened,
                r.settled,
                r.windows,
                r.prints,
                r.uploaded
                    .map_or(String::new(), |n| format!(", {n} file(s) pushed")),
            ),
            Err(e) => eprintln!("serve: minute failed: {e:#}"),
        }
        if once {
            break;
        }
    }
}
