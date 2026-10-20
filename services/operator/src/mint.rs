//! The chip mint (plan §00 REVAMP 2): Chaumian e-cash on Cashu's BDHKE (NUT-00), keysets per
//! NUT-01/02 and DLEQ proofs per NUT-12, on the `cashu` crate used standalone (no cdk mint, no
//! database of its own; the spent set lives in `engine.sqlite`).
//!
//! A chip is a bearer token `(secret, C)` with `C = k · hash_to_curve(secret)`. The mint signs a
//! *blinded* point it can't link to the chip later (`C_ = k · B_`, `B_ = Y + rG`), so when a chip
//! is spent the operator can't tell which deposit or which earlier trade it came from. Every
//! signature carries a DLEQ proof that it was made with the published key for its amount, and the
//! keyset itself is published in every signed bundle, so every client sees the same keys: the mint
//! can't tag one person with a key of their own.
//!
//! Unit `zat` (zatoshi, as Cashu's `sat`), on a 1-2-5 ladder. Keys are derived from a 64-byte seed
//! in the data directory (mode 0600), one derivation path per keyset (a key's child index is its
//! amount's position in the ladder, so two ladders on one path would share keys between amounts).
//! - Epoch 1, the active keyset (plan §00 T3 contract): 18 amounts from 0.00001 to 5 ZEC, so house
//!   payouts can be paid to the 1,000-zat grid. Path `m/1'`.
//! - Epoch 0: the first keyset (12 amounts from 0.001 ZEC, the master path). Its chips stay
//!   spendable; it never signs again.
//!
//! Every client sees the same single active keyset in each signed bundle (key consistency).

use std::{
    fs,
    io::Write as _,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use bitcoin::bip32::{ChildNumber, DerivationPath};
use cashu::{
    Amount, BlindSignature, BlindedMessage, CurrencyUnit, Id, MintKeySet, SECP256K1, dhke,
    nut02::KeySetVersion,
};
use rand::{TryRng as _, rngs::SysRng};
use serde_json::{Map, Value, json};

/// Chip amounts in zatoshi of the active keyset: 0.00001, 0.00002, 0.00005 … 5 ZEC.
pub const AMOUNTS_ZAT: [u64; 18] = [
    1_000,
    2_000,
    5_000,
    10_000,
    20_000,
    50_000,
    100_000,
    200_000,
    500_000,
    1_000_000,
    2_000_000,
    5_000_000,
    10_000_000,
    20_000_000,
    50_000_000,
    100_000_000,
    200_000_000,
    500_000_000,
];
/// The first keyset's amounts (epoch 0): 0.001 … 5 ZEC. Spend-only.
const EPOCH0_AMOUNTS_ZAT: [u64; 12] = [
    100_000,
    200_000,
    500_000,
    1_000_000,
    2_000_000,
    5_000_000,
    10_000_000,
    20_000_000,
    50_000_000,
    100_000_000,
    200_000_000,
    500_000_000,
];
/// The active keyset's derivation path index: `m/<epoch>'`.
const ACTIVE_EPOCH: u32 = 1;
pub const UNIT: &str = "zat";
const SEED_FILE: &str = "mint.seed";
const SEED_BYTES: usize = 64;
/// At most this many outputs or inputs per request.
pub const MAX_ITEMS: usize = 64;

pub struct Mint {
    /// The one keyset that signs.
    keyset: MintKeySet,
    /// Older keysets: their chips verify (and are spent into the active keyset); they never sign.
    retired: Vec<MintKeySet>,
}

/// One spendable chip, as a client sends it (the DLEQ stripped, NUT-12).
pub type Proof = cashu::Proof;

impl Mint {
    /// Loads the seed from `<data dir>/mint.seed`, creating it (0600) on first use.
    pub fn load(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join(SEED_FILE);
        let seed = if path.exists() {
            let bytes = fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
            ensure!(
                bytes.len() == SEED_BYTES,
                "{} is not {SEED_BYTES} bytes",
                path.display()
            );
            bytes
        } else {
            let mut bytes = vec![0u8; SEED_BYTES];
            SysRng
                .try_fill_bytes(&mut bytes)
                .map_err(|e| anyhow!("no system randomness: {e}"))?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .with_context(|| format!("creating {}", path.display()))?;
            file.write_all(&bytes)?;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
            bytes
        };
        let generate = |amounts: &[u64], path: DerivationPath| {
            MintKeySet::generate_from_seed(
                &SECP256K1,
                &seed,
                amounts,
                CurrencyUnit::custom(UNIT),
                path,
                0,
                None,
                KeySetVersion::Version01,
            )
        };
        let active_path = DerivationPath::from(vec![
            ChildNumber::from_hardened_idx(ACTIVE_EPOCH).expect("a small index"),
        ]);
        Ok(Self {
            keyset: generate(&AMOUNTS_ZAT, active_path),
            retired: vec![generate(&EPOCH0_AMOUNTS_ZAT, DerivationPath::master())],
        })
    }

    /// The active keyset's id: the only one new outputs may name.
    pub fn active_id(&self) -> Id {
        self.keyset.id
    }

    #[cfg(test)]
    pub fn keyset_id(&self) -> Id {
        self.keyset.id
    }

    /// `{ id, unit, keys: { amount: pubkey } }` of the active keyset, as NUT-01 `GET /v1/keys` and
    /// the signed bundle.
    pub fn keyset_json(&self) -> Value {
        keyset_value(&self.keyset)
    }

    /// Every keyset whose chips still spend, active first, as `keyset_json`.
    pub fn retired_json(&self) -> Vec<Value> {
        self.retired.iter().map(keyset_value).collect()
    }

    /// Blind-signs each output (with its DLEQ proof). Every output must name the active keyset and
    /// one of its amounts.
    pub fn sign(&self, outputs: &[BlindedMessage]) -> Result<Vec<BlindSignature>> {
        ensure!(
            !outputs.is_empty() && outputs.len() <= MAX_ITEMS,
            "bad output count"
        );
        outputs
            .iter()
            .map(|output| self.sign_one(output, output.amount))
            .collect()
    }

    /// Signs `value` onto blank outputs (NUT-08 style): the value's 1-2-5 split, largest first,
    /// onto the first outputs, whatever amount each carries. Unused outputs stay unsigned. A zero
    /// value signs nothing.
    pub fn sign_value(
        &self,
        outputs: &[BlindedMessage],
        value: u64,
    ) -> Result<Vec<BlindSignature>> {
        ensure!(outputs.len() <= MAX_ITEMS, "bad output count");
        let amounts = split(value)?;
        ensure!(
            amounts.len() <= outputs.len(),
            "{} outputs can't hold {value} zat (it needs {})",
            outputs.len(),
            amounts.len()
        );
        amounts
            .iter()
            .zip(outputs)
            .map(|(amount, output)| self.sign_one(output, Amount::from(*amount)))
            .collect()
    }

    fn sign_one(&self, output: &BlindedMessage, amount: Amount) -> Result<BlindSignature> {
        ensure!(output.keyset_id == self.keyset.id, "unknown keyset");
        let pair = self
            .keyset
            .keys
            .get(&amount)
            .ok_or_else(|| anyhow!("no key for amount {amount}"))?;
        let c = dhke::sign_message(&pair.secret_key, &output.blinded_secret)
            .map_err(|e| anyhow!("signing: {e}"))?;
        BlindSignature::new(
            amount,
            c,
            self.keyset.id,
            &output.blinded_secret,
            &pair.secret_key,
        )
        .map_err(|e| anyhow!("DLEQ: {e}"))
    }

    /// Checks each chip's signature (active or retired keyset) and returns its
    /// `Y = hash_to_curve(secret)` (compressed hex), the key of the spent set. Duplicates within
    /// one request are refused.
    pub fn verify(&self, proofs: &[Proof]) -> Result<Vec<String>> {
        ensure!(
            !proofs.is_empty() && proofs.len() <= MAX_ITEMS,
            "bad input count"
        );
        let mut ys = Vec::with_capacity(proofs.len());
        for proof in proofs {
            let keyset = std::iter::once(&self.keyset)
                .chain(&self.retired)
                .find(|k| k.id == proof.keyset_id)
                .ok_or_else(|| anyhow!("unknown keyset"))?;
            let pair = keyset
                .keys
                .get(&proof.amount)
                .ok_or_else(|| anyhow!("no key for amount {}", proof.amount))?;
            dhke::verify_message(&pair.secret_key, proof.c, proof.secret.as_bytes())
                .map_err(|_| anyhow!("a chip's signature is invalid"))?;
            let y = dhke::hash_to_curve(proof.secret.as_bytes())
                .map_err(|e| anyhow!("hash_to_curve: {e}"))?
                .to_hex();
            if ys.contains(&y) {
                bail!("the same chip twice");
            }
            ys.push(y);
        }
        Ok(ys)
    }
}

fn keyset_value(keyset: &MintKeySet) -> Value {
    let keys: Map<String, Value> = keyset
        .keys
        .iter()
        .map(|(amount, pair)| (amount.to_string(), Value::String(pair.public_key.to_hex())))
        .collect();
    json!({ "id": keyset.id.to_string(), "unit": UNIT, "keys": keys })
}

/// An amount as active-keyset chips, largest first (1-2-5 greedy: at most three per decade). The
/// amount must be on the smallest chip's grid.
pub fn split(value: u64) -> Result<Vec<u64>> {
    let smallest = AMOUNTS_ZAT[0];
    ensure!(
        value.is_multiple_of(smallest),
        "{value} zat is not a whole number of {smallest}-zat chips"
    );
    let mut rest = value;
    let mut out = Vec::new();
    for amount in AMOUNTS_ZAT.iter().rev() {
        while rest >= *amount {
            out.push(*amount);
            rest -= amount;
        }
    }
    Ok(out)
}

/// The sum of amounts, refusing overflow.
pub fn total(amounts: impl IntoIterator<Item = Amount>) -> Result<u64> {
    amounts.into_iter().try_fold(0u64, |sum, a| {
        sum.checked_add(u64::from(a))
            .ok_or_else(|| anyhow!("amount overflow"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cashu::{SecretKey, secret::Secret};

    /// A mint in its own directory per test (tests run in parallel).
    fn mint(name: &str) -> Mint {
        let dir = std::env::temp_dir().join(format!("kakure-mint-{name}-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        Mint::load(&dir).unwrap()
    }

    #[test]
    fn hash_to_curve_matches_the_nut00_vectors() {
        // NUT-00 tests/00-tests.md: the 32-byte messages 00…00, 00…01 and 00…02 (the last
        // needs several turns of the counter loop).
        let zero = [0u8; 32];
        let mut one = [0u8; 32];
        one[31] = 1;
        let mut two = [0u8; 32];
        two[31] = 2;
        assert_eq!(
            dhke::hash_to_curve(&two).unwrap().to_hex(),
            "026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f"
        );
        assert_eq!(
            dhke::hash_to_curve(&zero).unwrap().to_hex(),
            "024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725"
        );
        assert_eq!(
            dhke::hash_to_curve(&one).unwrap().to_hex(),
            "022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf"
        );
    }

    #[test]
    fn blind_sign_unblind_verify_and_dleq() {
        let mint = mint("sign");
        let secret = Secret::generate();
        let (b, r) = dhke::blind_message(secret.as_bytes(), None).unwrap();
        let output = BlindedMessage::new(Amount::from(1_000_000), mint.keyset_id(), b);
        let signature = mint.sign(std::slice::from_ref(&output)).unwrap().remove(0);
        let key = mint
            .keyset
            .keys
            .get(&Amount::from(1_000_000))
            .unwrap()
            .public_key;
        signature.verify_dleq(key, b).unwrap();
        let c = dhke::unblind_message(&signature.c, &r, &key).unwrap();
        let proof = Proof::new(Amount::from(1_000_000), mint.keyset_id(), secret, c);
        assert_eq!(mint.verify(std::slice::from_ref(&proof)).unwrap().len(), 1);
        assert!(
            mint.verify(&[proof.clone(), proof]).is_err(),
            "a chip twice"
        );
        // A chip whose amount was changed after signing doesn't verify.
        let forged = Proof::new(
            Amount::from(5_000_000),
            mint.keyset_id(),
            Secret::generate(),
            c,
        );
        assert!(mint.verify(&[forged]).is_err());
        let _ = SecretKey::generate();
    }

    #[test]
    fn blank_outputs_carry_the_split_and_retired_chips_still_verify() {
        let mint = mint("blank");
        let blanks: Vec<(BlindedMessage, Secret, SecretKey)> = (0..6)
            .map(|_| {
                let secret = Secret::generate();
                let (b, r) = dhke::blind_message(secret.as_bytes(), None).unwrap();
                (
                    BlindedMessage::new(Amount::from(0), mint.keyset_id(), b),
                    secret,
                    r,
                )
            })
            .collect();
        let outputs: Vec<BlindedMessage> = blanks.iter().map(|(o, _, _)| o.clone()).collect();
        let signatures = mint.sign_value(&outputs, 1_236_000).unwrap();
        let amounts: Vec<u64> = signatures.iter().map(|s| u64::from(s.amount)).collect();
        assert_eq!(
            amounts,
            vec![1_000_000, 200_000, 20_000, 10_000, 5_000, 1_000]
        );
        assert!(mint.sign_value(&outputs[..2], 1_236_000).is_err());
        assert!(mint.sign_value(&outputs, 1_500).is_err(), "off the grid");
        assert!(mint.sign_value(&outputs, 0).unwrap().is_empty());
        // Each unblinds to a chip that verifies.
        for ((output, secret, r), signature) in blanks.iter().zip(&signatures) {
            let key = mint.keyset.keys.get(&signature.amount).unwrap().public_key;
            signature.verify_dleq(key, output.blinded_secret).unwrap();
            let c = dhke::unblind_message(&signature.c, r, &key).unwrap();
            let proof = Proof::new(signature.amount, mint.keyset_id(), secret.clone(), c);
            mint.verify(&[proof]).unwrap();
        }
        // A chip of the retired keyset verifies but can't be minted any more.
        let old = &mint.retired[0];
        let pair = old.keys.get(&Amount::from(100_000)).unwrap();
        let secret = Secret::generate();
        let (b, r) = dhke::blind_message(secret.as_bytes(), None).unwrap();
        let c_ = dhke::sign_message(&pair.secret_key, &b).unwrap();
        let c = dhke::unblind_message(&c_, &r, &pair.public_key).unwrap();
        mint.verify(&[Proof::new(Amount::from(100_000), old.id, secret, c)])
            .unwrap();
        assert!(
            mint.sign(&[BlindedMessage::new(Amount::from(100_000), old.id, b)])
                .is_err()
        );
        assert_ne!(old.id, mint.keyset_id());
    }

    #[test]
    fn the_keyset_is_stable_and_spans_the_ladder() {
        let a = mint("stable");
        let b = mint("stable");
        assert_eq!(a.keyset_id(), b.keyset_id());
        assert_eq!(
            a.keyset_json()["keys"].as_object().unwrap().len(),
            AMOUNTS_ZAT.len()
        );
        assert!(a.keyset_id().to_string().starts_with("01"));
    }
}
