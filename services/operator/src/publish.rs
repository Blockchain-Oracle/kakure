//! Writes the signed public files and mirrors them to R2.
//!
//! Output: `operator-data/<net>/public/<net>/{bundle-<seq>,addresses-<hash8>,latest}.json`, the
//! same `<network>/<file>.json` keys the data-worker serves from R2. Each file is the canonical
//! JSON of its signed document, so `SHA-256(file bytes)` is the document hash clients check.
//! Immutable files are written (and uploaded) first; `latest.json` advances last (plan §13.11).

use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use serde_json::Value;

use crate::{
    r2::R2,
    signing::{self, Keypair, canonical_json, file_hash},
    store::Store,
};

pub const LATEST_FILE: &str = "latest.json";

pub struct Publisher {
    /// `<data-dir>/public`; files go under `<network>/`.
    root: PathBuf,
    network: &'static str,
    r2: Option<R2>,
}

/// A signed document ready to write.
pub struct SignedFile {
    pub bytes: Vec<u8>,
    pub hash: String,
}

pub fn sign_file(key: &Keypair, document: &Value) -> Result<SignedFile> {
    let signed = key.sign(document)?;
    signing::verify(&signed, &key.public())?;
    let bytes = canonical_json(&signed)?.into_bytes();
    let hash = file_hash(&bytes);
    Ok(SignedFile { bytes, hash })
}

impl Publisher {
    pub fn new(data_dir: &Path, network: &'static str, r2: Option<R2>) -> Self {
        Self {
            root: data_dir.join("public"),
            network,
            r2,
        }
    }

    pub fn dir(&self) -> PathBuf {
        self.root.join(self.network)
    }

    pub fn r2(&self) -> Option<&R2> {
        self.r2.as_ref()
    }

    /// Writes `name` atomically (temp file + rename). Immutable files must not change once written.
    pub fn write(&self, name: &str, bytes: &[u8], immutable: bool) -> Result<()> {
        let dir = self.dir();
        fs::create_dir_all(&dir)?;
        let path = dir.join(name);
        if immutable && path.exists() {
            let existing = fs::read(&path)?;
            if existing == bytes {
                return Ok(());
            }
            // Only an unreferenced leftover from a crash before the DB commit gets here.
            ensure!(
                !name.starts_with("addresses-"),
                "{name} exists with different content"
            );
        }
        let tmp = dir.join(format!(".{name}.tmp"));
        fs::write(&tmp, bytes).with_context(|| format!("writing {}", tmp.display()))?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub fn read(&self, name: &str) -> Result<Vec<u8>> {
        let path = self.dir().join(name);
        fs::read(&path).with_context(|| format!("reading {}", path.display()))
    }

    /// Pushes every immutable file R2 does not have yet (address lists, then bundles in order),
    /// then `latest.json`. A failure leaves the rest for the next tick.
    pub async fn sync_r2(&self, http: &reqwest::Client, store: &Store, now: i64) -> Result<usize> {
        let Some(r2) = &self.r2 else {
            return Ok(0);
        };
        let mut pending: Vec<String> = vec![];
        for sql in [
            "SELECT file FROM address_lists ORDER BY seq",
            "SELECT resolution_file FROM markets WHERE resolution_file IS NOT NULL ORDER BY resolved_at",
            "SELECT file FROM history_files ORDER BY day",
            "SELECT file FROM bundles ORDER BY seq",
        ] {
            let mut stmt = store.conn.prepare(sql)?;
            for file in stmt.query_map([], |r| r.get::<_, String>(0))? {
                let file = file?;
                if !store.uploaded(&file)? {
                    pending.push(file);
                }
            }
        }
        let mut uploaded = 0;
        for file in &pending {
            r2.put(http, &format!("{}/{file}", self.network), self.read(file)?)
                .await?;
            store.mark_uploaded(file, now)?;
            uploaded += 1;
        }
        r2.put(
            http,
            &format!("{}/{LATEST_FILE}", self.network),
            self.read(LATEST_FILE)?,
        )
        .await?;
        Ok(uploaded + 1)
    }
}
