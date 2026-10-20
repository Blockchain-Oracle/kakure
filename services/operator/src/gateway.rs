//! The Oblivious HTTP gateway (RFC 9458; plan §00 REVAMP 2) in front of the trading API.
//!
//! Every client request reaches the operator HPKE-encrypted to this key and relayed by the data
//! worker: the relay sees the client's IP but not the request; the gateway sees the request but
//! only the relay's address. The key is derived from a 32-byte seed kept in the data directory
//! (mode 0600, like the signing key), so the published key config never changes across restarts;
//! it goes in every signed bundle, so every client encrypts to the same key (key consistency,
//! RFC 9458 §6.1, §7). One suite only: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM, the
//! one browsers, Workers and the `ohttp` crate all support.

use std::{
    fs,
    io::{Cursor, Write as _},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
};

use anyhow::{Context, Result, anyhow, ensure};
use bhttp::{Message, Mode};
use ohttp::{
    KeyConfig, Server, SymmetricSuite,
    hpke::{Aead, Kdf, Kem},
};
use rand::{TryRng as _, rngs::SysRng};

const SEED_FILE: &str = "ohttp.seed";
const SEED_BYTES: usize = 32;
/// The key's id inside the config (RFC 9458 §3); bumped only if the key is ever rotated.
const KEY_ID: u8 = 1;
/// Requests and responses larger than this are refused before decryption.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

pub struct Gateway {
    server: Server,
    /// `application/ohttp-keys`: the encoded key config list clients encrypt to.
    key_config: Vec<u8>,
}

/// A decrypted inner request: its method, path and body (headers carry nothing we read).
pub struct Inner {
    pub method: String,
    pub path: String,
    pub body: Vec<u8>,
}

/// What a route answers: a status and a JSON body.
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

impl Gateway {
    /// Loads the seed from `<data dir>/ohttp.seed`, creating it (0600) on first use.
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
        ohttp::init();
        let config = KeyConfig::derive(
            KEY_ID,
            Kem::X25519Sha256,
            vec![SymmetricSuite::new(Kdf::HkdfSha256, Aead::Aes128Gcm)],
            &seed,
        )
        .map_err(|e| anyhow!("deriving the gateway key: {e}"))?;
        let key_config = KeyConfig::encode_list(&[&config])
            .map_err(|e| anyhow!("encoding the key config: {e}"))?;
        let server = Server::new(config).map_err(|e| anyhow!("starting the gateway: {e}"))?;
        Ok(Self { server, key_config })
    }

    pub fn key_config(&self) -> &[u8] {
        &self.key_config
    }

    /// Decrypts one `message/ohttp-req`, answers it with `route`, and encrypts the answer as
    /// `message/ohttp-res`. An undecryptable request is an error (the HTTP layer answers 400).
    pub fn handle(
        &self,
        encapsulated: &[u8],
        route: impl FnOnce(Inner) -> Reply,
    ) -> Result<Vec<u8>> {
        ensure!(encapsulated.len() <= MAX_MESSAGE_BYTES, "request too large");
        let (plain, response) = self
            .server
            .decapsulate(encapsulated)
            .map_err(|e| anyhow!("decapsulating: {e}"))?;
        let message = Message::read_bhttp::<_, Cursor<&[u8]>>(&mut Cursor::new(&plain[..]))
            .map_err(|e| anyhow!("binary HTTP: {e}"))?;
        let control = message.control();
        let inner = Inner {
            method: String::from_utf8_lossy(control.method().unwrap_or_default()).into_owned(),
            path: String::from_utf8_lossy(control.path().unwrap_or_default()).into_owned(),
            body: message.content().to_vec(),
        };
        let reply = route(inner);
        let mut answer = Message::response(
            bhttp::StatusCode::try_from(reply.status).map_err(|e| anyhow!("status: {e}"))?,
        );
        answer.put_header("content-type", "application/json");
        answer.write_content(&reply.body);
        let mut bytes = Vec::new();
        answer
            .write_bhttp(Mode::KnownLength, &mut bytes)
            .map_err(|e| anyhow!("binary HTTP: {e}"))?;
        // RFC 9292 §3.8: zero padding after a known-length message, so a response's size says nothing about which
        // call it answers or how many chips it signs (privacy re-audit V4); the client pads its requests the same way.
        bytes.resize(padded_len(bytes.len()), 0);
        response
            .encapsulate(&bytes)
            .map_err(|e| anyhow!("encapsulating: {e}"))
    }
}

/// Response sizes, in Binary HTTP bytes: the smallest bucket that fits, then whole multiples of the last.
const RESPONSE_BUCKETS: [usize; 3] = [4 * 1024, 16 * 1024, 64 * 1024];

pub fn padded_len(len: usize) -> usize {
    if let Some(bucket) = RESPONSE_BUCKETS.iter().find(|&&b| b >= len) {
        return *bucket;
    }
    let step = RESPONSE_BUCKETS[RESPONSE_BUCKETS.len() - 1];
    len.div_ceil(step) * step
}

#[cfg(test)]
mod tests {
    use super::padded_len;

    #[test]
    fn responses_pad_to_buckets() {
        assert_eq!(padded_len(1), 4_096);
        assert_eq!(padded_len(4_096), 4_096);
        assert_eq!(padded_len(4_097), 16_384);
        assert_eq!(padded_len(20_000), 65_536);
        assert_eq!(padded_len(65_537), 131_072);
    }
}
