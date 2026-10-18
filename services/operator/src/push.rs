//! Pushes the signed public files to the data worker (services/data-worker), set by `KAKURE_PUSH_URL`
//! (its `/data` URL, e.g. `https://kakure-web.kakure-price-relay.workers.dev/data`).
//!
//! The push carries no credential: the worker keeps a file only when it is a document signed with the
//! operator key pinned for its network, never replaces a published file, and moves `latest.json` only
//! forward to a bundle it already holds. The signing key the operator already has is the whole
//! authority, so there is no storage secret to leak. The operator only pushes; clients never talk to
//! it (plan §2).

use anyhow::{Result, bail, ensure};

const ENV_PUSH_URL: &str = "KAKURE_PUSH_URL";
/// The worker's replies are one word (`stored`, `unchanged`, `stale`…); anything longer is cut.
const REPLY_PREVIEW_CHARS: usize = 200;

pub struct Push {
    base: String,
}

impl Push {
    /// `None` when no push URL is set: the files are then only written under `operator-data`.
    pub fn from_env() -> Result<Option<Self>> {
        let Some(base) = std::env::var(ENV_PUSH_URL).ok().filter(|v| !v.is_empty()) else {
            return Ok(None);
        };
        let base = base.trim_end_matches('/').to_string();
        let local = base.starts_with("http://127.0.0.1:") || base.starts_with("http://localhost:");
        ensure!(
            base.starts_with("https://") || local,
            "{ENV_PUSH_URL} must be an https:// URL (http only for a local worker)"
        );
        ensure!(
            base.ends_with("/data"),
            "{ENV_PUSH_URL} must be the worker's /data URL"
        );
        Ok(Some(Self { base }))
    }

    pub fn describe(&self) -> &str {
        &self.base
    }

    /// PUTs one file at `<network>/<file>`. Both `stored` (201) and `unchanged` (200) are success.
    pub async fn put(&self, http: &reqwest::Client, key: &str, body: Vec<u8>) -> Result<()> {
        let response = http
            .put(format!("{}/{key}", self.base))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let reply: String = response
                .text()
                .await
                .unwrap_or_default()
                .chars()
                .take(REPLY_PREVIEW_CHARS)
                .collect();
            bail!("push {key}: HTTP {status}: {reply}");
        }
        Ok(())
    }
}
