//! The operator wallet: one account per data dir, backed by `zcash_client_sqlite`.
//!
//! The mnemonic lives in `<data-dir>/mnemonic` (mode 0600, directory 0700) and is never
//! printed. The data dir is git-ignored (`operator-data/`).

use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use bip0039::{Count, English, Mnemonic};
use clap::ValueEnum;
use rand::{rand_core::UnwrapErr, rngs::SysRng};
use secrecy::{ExposeSecret, SecretString, SecretVec, Zeroize};
use zcash_client_backend::data_api::{
    Account as _, AccountBirthday, WalletRead, WalletWrite, wallet::ConfirmationsPolicy,
};
use zcash_client_sqlite::{AccountUuid, WalletDb, util::SystemClock, wallet::init::init_wallet_db};
use zcash_keys::keys::UnifiedAddressRequest;
use zcash_protocol::{
    consensus::Network,
    memo::{Memo, MemoBytes},
};
use zip32::DiversifierIndex;

pub type Db = WalletDb<rusqlite::Connection, Network, SystemClock, UnwrapErr<SysRng>>;
pub type Account = <Db as WalletRead>::Account;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Net {
    Testnet,
    Mainnet,
}

impl Net {
    pub fn params(self) -> Network {
        match self {
            Net::Testnet => Network::TestNetwork,
            Net::Mainnet => Network::MainNetwork,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Net::Testnet => "testnet",
            Net::Mainnet => "mainnet",
        }
    }
}

/// A wallet data directory.
pub struct Wallet {
    pub dir: PathBuf,
    pub net: Net,
}

impl Wallet {
    pub fn new(net: Net, dir: Option<PathBuf>) -> Self {
        let dir = dir.unwrap_or_else(|| PathBuf::from("operator-data").join(net.name()));
        Self { dir, net }
    }

    fn db_path(&self) -> PathBuf {
        self.dir.join("wallet.sqlite")
    }

    fn mnemonic_path(&self) -> PathBuf {
        self.dir.join("mnemonic")
    }

    fn network_path(&self) -> PathBuf {
        self.dir.join("network")
    }

    pub fn tor_dir(&self) -> PathBuf {
        self.dir.join("tor")
    }

    pub fn exists(&self) -> bool {
        self.db_path().exists() || self.mnemonic_path().exists()
    }

    /// Opens the wallet DB, checking that it belongs to the requested network.
    pub fn open(&self) -> Result<Db> {
        let stored = fs::read_to_string(self.network_path())
            .with_context(|| format!("no wallet in {} (run init)", self.dir.display()))?;
        ensure!(
            stored.trim() == self.net.name(),
            "{} holds a {} wallet, not {}",
            self.dir.display(),
            stored.trim(),
            self.net.name()
        );
        Ok(WalletDb::for_path(
            self.db_path(),
            self.net.params(),
            SystemClock,
            UnwrapErr(SysRng),
        )?)
    }

    /// Creates the data dir, stores the mnemonic (0600) and creates the account.
    ///
    /// `phrase` is `None` for a new wallet (a 24-word mnemonic is generated) or the phrase of
    /// a wallet being restored.
    pub fn create(&self, phrase: Option<SecretString>, birthday: &AccountBirthday) -> Result<()> {
        ensure!(
            !self.exists(),
            "{} already holds a wallet; refusing to overwrite",
            self.dir.display()
        );
        fs::create_dir_all(&self.dir)?;
        fs::set_permissions(&self.dir, fs::Permissions::from_mode(0o700))?;

        let mnemonic = match phrase {
            Some(p) => <Mnemonic<English>>::from_phrase(p.expose_secret().trim())
                .map_err(|e| anyhow!("invalid mnemonic: {e}"))?,
            None => Mnemonic::<English>::generate(Count::Words24),
        };
        write_secret_file(&self.mnemonic_path(), mnemonic.phrase().as_bytes())?;
        fs::write(self.network_path(), self.net.name())?;

        let seed = seed_of(&mnemonic);
        let mut db = WalletDb::for_path(
            self.db_path(),
            self.net.params(),
            SystemClock,
            UnwrapErr(SysRng),
        )?;
        init_wallet_db(&mut db, None).map_err(|e| anyhow!("wallet DB init: {e:?}"))?;
        db.create_account("kakure-operator", &seed, birthday, None)?;
        fs::set_permissions(self.db_path(), fs::Permissions::from_mode(0o600))?;
        Ok(())
    }

    /// Reads the stored mnemonic and returns the BIP 39 seed.
    pub fn seed(&self) -> Result<SecretVec<u8>> {
        let mut phrase = fs::read_to_string(self.mnemonic_path()).context("reading mnemonic")?;
        let mnemonic = <Mnemonic<English>>::from_phrase(phrase.trim())
            .map_err(|e| anyhow!("stored mnemonic is invalid: {e}"));
        phrase.zeroize();
        Ok(seed_of(&mnemonic?))
    }
}

/// Reads a mnemonic phrase from a file without echoing it anywhere.
pub fn read_phrase(path: &Path) -> Result<SecretString> {
    let mut phrase =
        fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let secret = SecretString::new(phrase.trim().to_string());
    phrase.zeroize();
    Ok(secret)
}

fn seed_of(mnemonic: &Mnemonic<English>) -> SecretVec<u8> {
    let mut seed = mnemonic.to_seed("");
    let secret = SecretVec::new(seed.to_vec());
    seed.zeroize();
    secret
}

fn write_secret_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .with_context(|| format!("creating {}", path.display()))?;
    f.write_all(bytes)?;
    f.write_all(b"\n")?;
    f.sync_all()?;
    Ok(())
}

/// The single account in this wallet.
pub fn account(db: &Db) -> Result<Account> {
    let ids = db.get_account_ids()?;
    let [id] = ids[..] else {
        bail!("expected exactly one account, found {}", ids.len());
    };
    db.get_account(id)?
        .ok_or_else(|| anyhow!("account {id:?} missing"))
}

pub fn account_id(db: &Db) -> Result<AccountUuid> {
    Ok(account(db)?.id())
}

/// Derives Orchard-only diversified Unified Addresses `start..start+count`.
///
/// Each address is derived offline from the account UIVK, registered (exposed) in the wallet
/// at the same index, and then checked against the account's single Orchard IVK, which must
/// recover the same diversifier index. Returns `(index, encoded UA)`.
pub fn addresses(db: &mut Db, net: Net, start: u32, count: u32) -> Result<Vec<(u32, String)>> {
    let params = net.params();
    let account = account(db)?;
    let uivk = account.uivk();
    let orchard_ivk = uivk
        .orchard()
        .clone()
        .ok_or_else(|| anyhow!("account has no Orchard IVK"))?;

    let mut out = Vec::with_capacity(count as usize);
    for j in start
        ..start
            .checked_add(count)
            .ok_or_else(|| anyhow!("index overflow"))?
    {
        let idx = DiversifierIndex::from(j);
        let offline = uivk
            .address(idx, UnifiedAddressRequest::ORCHARD)
            .map_err(|e| anyhow!("deriving index {j}: {e:?}"))?;
        let stored = db
            .get_address_for_index(account.id(), idx, UnifiedAddressRequest::ORCHARD)?
            .ok_or_else(|| anyhow!("wallet refused index {j}"))?;
        let encoded = stored.encode(&params);
        ensure!(
            offline.encode(&params) == encoded,
            "offline and wallet derivation differ at {j}"
        );
        ensure!(
            stored.has_orchard() && !stored.has_sapling() && !stored.has_transparent(),
            "address {j} is not Orchard-only"
        );
        let receiver = stored.orchard().expect("checked above");
        ensure!(
            orchard_ivk.diversifier_index(receiver) == Some(idx),
            "the account IVK does not recognise address {j}"
        );
        out.push((j, encoded));
    }
    Ok(out)
}

/// Prints spendable balance per shielded pool.
pub fn print_balance(db: &Db) -> Result<()> {
    let id = account_id(db)?;
    let summary = db
        .get_wallet_summary(ConfirmationsPolicy::default())?
        .ok_or_else(|| anyhow!("no wallet summary yet (run sync)"))?;
    let bal = summary
        .account_balances()
        .get(&id)
        .ok_or_else(|| anyhow!("account missing from summary"))?;
    println!(
        "chain tip {}  fully scanned {}",
        summary.chain_tip_height(),
        summary.fully_scanned_height()
    );
    for (name, b) in [
        ("Ironwood", bal.ironwood_balance()),
        ("Orchard", bal.orchard_balance()),
        ("Sapling", bal.sapling_balance()),
    ] {
        println!(
            "{name:<9} spendable {:>12} zat  pending change {:>12} zat  pending other {:>12} zat",
            b.spendable_value().into_u64(),
            b.change_pending_confirmation().into_u64(),
            b.value_pending_spendability().into_u64(),
        );
    }
    println!("total     {:>22} zat", bal.total().into_u64());
    Ok(())
}

/// One row of `v_tx_outputs` (zcash_client_sqlite's public view).
pub struct Output {
    pub txid: String,
    pub height: Option<u32>,
    pub pool: &'static str,
    pub index: u32,
    pub from_us: bool,
    pub to_us: bool,
    pub to_address: Option<String>,
    pub diversifier_index: Option<u128>,
    pub value: u64,
    pub is_change: bool,
    pub memo: Option<String>,
}

pub fn outputs(db_dir: &Wallet) -> Result<Vec<Output>> {
    let conn = rusqlite::Connection::open_with_flags(
        db_dir.db_path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut stmt = conn.prepare(
        "SELECT txid, tx_mined_height, output_pool, output_index, from_account_uuid,
                to_account_uuid, to_address, diversifier_index_be, value, is_change, memo
         FROM v_tx_outputs
         ORDER BY tx_mined_height IS NULL, tx_mined_height, txid, output_pool, output_index",
    )?;
    let rows = stmt.query_map([], |r| {
        let mut txid: Vec<u8> = r.get(0)?;
        txid.reverse();
        let pool = match r.get::<_, i64>(2)? {
            0 => "transparent",
            2 => "sapling",
            3 => "orchard",
            4 => "ironwood",
            _ => "unknown",
        };
        let div: Option<Vec<u8>> = r.get(7)?;
        let memo: Option<Vec<u8>> = r.get(10)?;
        Ok(Output {
            txid: hex::encode(txid),
            height: r.get(1)?,
            pool,
            index: r.get(3)?,
            from_us: r.get::<_, Option<Vec<u8>>>(4)?.is_some(),
            to_us: r.get::<_, Option<Vec<u8>>>(5)?.is_some(),
            to_address: r.get(6)?,
            diversifier_index: div
                .map(|be| be.iter().fold(0u128, |acc, b| (acc << 8) | u128::from(*b))),
            value: r.get::<_, i64>(8)? as u64,
            is_change: r.get(9)?,
            memo: memo.and_then(|m| memo_text(&m)),
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Plain-text memo content; `None` for the empty memo (0xF6) and non-text memos.
fn memo_text(bytes: &[u8]) -> Option<String> {
    let memo = MemoBytes::from_bytes(bytes).ok()?;
    match Memo::try_from(memo).ok()? {
        Memo::Text(t) => Some(String::from(t)),
        Memo::Empty => None,
        Memo::Arbitrary(_) | Memo::Future(_) => Some("<non-text memo>".into()),
    }
}
