//! The Oblivious HTTP gateway (RFC 9458; plan §00 REVAMP 2) in front of the trading API.
//!
//! Every client request reaches the operator HPKE-encrypted to the gateway's key and relayed by the
//! data worker: the relay sees the client's IP but not the request; the gateway sees the request
//! but only the relay's address. One suite only: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256,
//! AES-128-GCM, the one browsers, Workers and the `ohttp` crate all support.
//!
//! The key rotates every hour (privacy re-audit V11; RFC 9458 §6.6: "a measure of forward secrecy
//! can be provided by generating a new key configuration then deleting the old keys"):
//!
//! - each hour's key comes from 32 fresh random bytes, never from a long-lived seed, kept 0600 in
//!   `<data dir>/ohttp-keys/` so a restart within the hour keeps it;
//! - the minute loop rotates it and publishes the current key in every signed bundle, so every
//!   client encrypts to the same key (key consistency, RFC 9458 §7);
//! - the key the last bundle named is still accepted for `OVERLAP_SECS` after the new one is first
//!   published, then dropped and its file deleted, so a later compromise of the operator can't
//!   decrypt older requests, even by someone who recorded them at the relay;
//! - a request to a key the gateway no longer holds gets RFC 9458 §5.3's `ohttp-key` problem, and
//!   the client fetches the current bundle and sends the same request once more.

use std::{
    fs,
    io::{Cursor, ErrorKind, Write as _},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::RwLock,
};

use anyhow::{Context, Result, anyhow, ensure};
use bhttp::{Message, Mode};
use ohttp::{
    KeyConfig, Server, SymmetricSuite,
    hpke::{Aead, Kdf, Kem},
};
use rand::{TryRng as _, rngs::SysRng};

const KEYS_DIR: &str = "ohttp-keys";
const KEY_FILE_SUFFIX: &str = ".seed";
/// The first gateway's never-rotating seed: deleted when this gateway loads.
const LEGACY_SEED_FILE: &str = "ohttp.seed";
const SEED_BYTES: usize = 32;
/// A fresh key every hour.
pub const ROTATE_SECS: i64 = 3_600;
/// How long the previous key is still accepted once the next one is published: clients pick the
/// new key up with the next minute's bundle, and one that slept past this retries once.
pub const OVERLAP_SECS: i64 = 10 * 60;
/// Key ids are one byte (RFC 9458 §3.1) and cycle through 1..=255, so neighbouring hours differ.
const KEY_IDS: i64 = 255;
/// Requests and responses larger than this are refused before decryption.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
/// RFC 9458 §5.3: the problem type for a request to an outdated or unknown key.
pub const KEY_PROBLEM_TYPE: &str = "https://iana.org/assignments/http-problem-types#ohttp-key";

/// One hour's key: the server that decrypts to it and its `application/ohttp-keys` encoding.
struct HourKey {
    hour: i64,
    server: Server,
    config: Vec<u8>,
}

struct Keys {
    current: HourKey,
    /// The key the last bundles named before `current`, and when it stops being accepted.
    previous: Option<(HourKey, i64)>,
}

impl Keys {
    fn server(&self, id: u8) -> Option<&Server> {
        if key_id(self.current.hour) == id {
            return Some(&self.current.server);
        }
        self.previous
            .as_ref()
            .filter(|(key, _)| key_id(key.hour) == id)
            .map(|(key, _)| &key.server)
    }

    fn hours(&self) -> Vec<i64> {
        let mut hours = vec![self.current.hour];
        hours.extend(self.previous.as_ref().map(|(key, _)| key.hour));
        hours
    }
}

pub struct Gateway {
    dir: PathBuf,
    keys: RwLock<Keys>,
}

/// Why a request got no encrypted answer; the HTTP layer answers 400 either way, never with details.
#[derive(Debug, PartialEq, Eq)]
pub enum GatewayError {
    /// The request names a key this gateway doesn't hold: an old bundle's, or none of ours.
    UnknownKey,
    /// Too large, undecryptable or not Binary HTTP.
    Invalid,
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

/// The hour a time falls in, as a count of hours since 1970.
fn hour_of(now: i64) -> i64 {
    now.div_euclid(ROTATE_SECS)
}

fn key_id(hour: i64) -> u8 {
    u8::try_from(hour.rem_euclid(KEY_IDS) + 1).unwrap_or(1)
}

impl Gateway {
    /// Loads this hour's key from `<data dir>/ohttp-keys/`, creating it (0600) when missing, and
    /// the previous hour's when `now` is still inside its overlap. Every other key file is deleted,
    /// and so is the first gateway's never-rotating seed.
    pub fn load(data_dir: &Path, now: i64) -> Result<Self> {
        ohttp::init();
        let dir = data_dir.join(KEYS_DIR);
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)
            .with_context(|| format!("creating {}", dir.display()))?;
        remove_if_present(&data_dir.join(LEGACY_SEED_FILE))?;
        let hour = hour_of(now);
        let current = HourKey::load_or_create(&dir, hour)?;
        let until = hour * ROTATE_SECS + OVERLAP_SECS;
        let previous = if now < until {
            HourKey::load(&dir, hour - 1)?.map(|key| (key, until))
        } else {
            None
        };
        let keys = Keys { current, previous };
        sweep(&dir, &keys.hours())?;
        Ok(Self {
            dir,
            keys: RwLock::new(keys),
        })
    }

    /// The minute loop's call, before it publishes: once the hour turns, makes the new hour's key
    /// current and keeps the old one for `OVERLAP_SECS`; once that passes, drops the old key and
    /// deletes its file.
    pub fn rotate(&self, now: i64) -> Result<()> {
        let hours = {
            let mut keys = self
                .keys
                .write()
                .map_err(|_| anyhow!("gateway keys poisoned"))?;
            if keys
                .previous
                .as_ref()
                .is_some_and(|(_, until)| now >= *until)
            {
                keys.previous = None;
            }
            let hour = hour_of(now);
            if hour > keys.current.hour {
                let fresh = HourKey::load_or_create(&self.dir, hour)?;
                let old = std::mem::replace(&mut keys.current, fresh);
                keys.previous = Some((old, now + OVERLAP_SECS));
            }
            keys.hours()
        };
        sweep(&self.dir, &hours)
    }

    /// `application/ohttp-keys`: the current key's config, the one the bundle publishes.
    pub fn key_config(&self) -> Vec<u8> {
        self.keys
            .read()
            .map(|keys| keys.current.config.clone())
            .unwrap_or_default()
    }

    /// Decrypts one `message/ohttp-req` with the key its first byte names, answers it with `route`,
    /// and encrypts the answer as `message/ohttp-res`.
    pub fn handle(
        &self,
        encapsulated: &[u8],
        route: impl FnOnce(Inner) -> Reply,
    ) -> std::result::Result<Vec<u8>, GatewayError> {
        if encapsulated.len() > MAX_MESSAGE_BYTES {
            return Err(GatewayError::Invalid);
        }
        let id = *encapsulated.first().ok_or(GatewayError::Invalid)?;
        let (plain, response) = {
            let keys = self.keys.read().map_err(|_| GatewayError::Invalid)?;
            let server = keys.server(id).ok_or(GatewayError::UnknownKey)?;
            server
                .decapsulate(encapsulated)
                .map_err(|_| GatewayError::Invalid)?
        };
        let message = Message::read_bhttp::<_, Cursor<&[u8]>>(&mut Cursor::new(&plain[..]))
            .map_err(|_| GatewayError::Invalid)?;
        let control = message.control();
        let inner = Inner {
            method: String::from_utf8_lossy(control.method().unwrap_or_default()).into_owned(),
            path: String::from_utf8_lossy(control.path().unwrap_or_default()).into_owned(),
            body: message.content().to_vec(),
        };
        let reply = route(inner);
        let mut answer = Message::response(
            bhttp::StatusCode::try_from(reply.status).map_err(|_| GatewayError::Invalid)?,
        );
        answer.put_header("content-type", "application/json");
        answer.write_content(&reply.body);
        let mut bytes = Vec::new();
        answer
            .write_bhttp(Mode::KnownLength, &mut bytes)
            .map_err(|_| GatewayError::Invalid)?;
        // RFC 9292 §3.8: zero padding after a known-length message, so a response's size says nothing about which
        // call it answers or how many chips it signs (privacy re-audit V4); the client pads its requests the same way.
        bytes.resize(padded_len(bytes.len()), 0);
        response
            .encapsulate(&bytes)
            .map_err(|_| GatewayError::Invalid)
    }
}

impl HourKey {
    fn path(dir: &Path, hour: i64) -> PathBuf {
        dir.join(format!("{hour}{KEY_FILE_SUFFIX}"))
    }

    fn from_seed(hour: i64, seed: &[u8]) -> Result<Self> {
        ensure!(
            seed.len() == SEED_BYTES,
            "a gateway key file is not {SEED_BYTES} bytes"
        );
        let config = KeyConfig::derive(
            key_id(hour),
            Kem::X25519Sha256,
            vec![SymmetricSuite::new(Kdf::HkdfSha256, Aead::Aes128Gcm)],
            seed,
        )
        .map_err(|e| anyhow!("deriving the gateway key: {e}"))?;
        let encoded = KeyConfig::encode_list(&[&config])
            .map_err(|e| anyhow!("encoding the key config: {e}"))?;
        let server = Server::new(config).map_err(|e| anyhow!("starting the gateway: {e}"))?;
        Ok(Self {
            hour,
            server,
            config: encoded,
        })
    }

    fn load(dir: &Path, hour: i64) -> Result<Option<Self>> {
        let path = Self::path(dir, hour);
        match fs::read(&path) {
            Ok(seed) => Self::from_seed(hour, &seed).map(Some),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
        }
    }

    fn load_or_create(dir: &Path, hour: i64) -> Result<Self> {
        if let Some(key) = Self::load(dir, hour)? {
            return Ok(key);
        }
        let mut seed = vec![0u8; SEED_BYTES];
        SysRng
            .try_fill_bytes(&mut seed)
            .map_err(|e| anyhow!("no system randomness: {e}"))?;
        let path = Self::path(dir, hour);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .with_context(|| format!("creating {}", path.display()))?;
        file.write_all(&seed)?;
        file.sync_all()?;
        Self::from_seed(hour, &seed)
    }
}

fn remove_if_present(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).with_context(|| format!("deleting {}", path.display())),
    }
}

/// Deletes every key file but the hours still in use.
fn sweep(dir: &Path, keep: &[i64]) -> Result<()> {
    for entry in fs::read_dir(dir).with_context(|| format!("listing {}", dir.display()))? {
        let path = entry?.path();
        let hour = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_suffix(KEY_FILE_SUFFIX))
            .and_then(|stem| stem.parse::<i64>().ok());
        if hour.is_some_and(|hour| !keep.contains(&hour)) {
            remove_if_present(&path)?;
        }
    }
    Ok(())
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
    use super::*;

    const HOUR: i64 = 1_792_504_800;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kakure-gateway-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// One `GET /v1/ping` encrypted to a published key config; the client side of the round trip.
    fn ping(config: &[u8]) -> (Vec<u8>, ohttp::ClientResponse) {
        let mut request = Vec::new();
        Message::request(
            b"GET".to_vec(),
            b"https".to_vec(),
            b"gateway.kakure".to_vec(),
            b"/v1/ping".to_vec(),
        )
        .write_bhttp(Mode::KnownLength, &mut request)
        .unwrap();
        ohttp::ClientRequest::from_encoded_config_list(config)
            .unwrap()
            .encapsulate(&request)
            .unwrap()
    }

    fn answer(gateway: &Gateway, request: &[u8]) -> std::result::Result<Vec<u8>, GatewayError> {
        gateway.handle(request, |inner| Reply {
            status: 200,
            body: inner.path.into_bytes(),
        })
    }

    fn key_files(dir: &Path) -> usize {
        fs::read_dir(dir.join(KEYS_DIR)).unwrap().count()
    }

    #[test]
    fn responses_pad_to_buckets() {
        assert_eq!(padded_len(1), 4_096);
        assert_eq!(padded_len(4_096), 4_096);
        assert_eq!(padded_len(4_097), 16_384);
        assert_eq!(padded_len(20_000), 65_536);
        assert_eq!(padded_len(65_537), 131_072);
    }

    #[test]
    fn key_ids_cycle_and_neighbours_differ() {
        for hour in [0, 253, 254, 255, 497_918, -1] {
            assert!((1..=255).contains(&key_id(hour)));
            assert_ne!(key_id(hour), key_id(hour + 1));
        }
    }

    #[test]
    fn a_restart_within_the_hour_keeps_the_key_and_the_old_seed_goes() {
        let dir = scratch("restart");
        fs::write(dir.join(LEGACY_SEED_FILE), [7u8; SEED_BYTES]).unwrap();
        let first = Gateway::load(&dir, HOUR + 100).unwrap().key_config();
        assert!(!dir.join(LEGACY_SEED_FILE).exists());
        assert_eq!(
            Gateway::load(&dir, HOUR + 3_000).unwrap().key_config(),
            first
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_old_key_works_through_the_overlap_then_is_deleted() {
        let dir = scratch("rotate");
        let gateway = Gateway::load(&dir, HOUR + 100).unwrap();
        let old = gateway.key_config();
        let (request, client) = ping(&old);
        let reply = client
            .decapsulate(&answer(&gateway, &request).unwrap())
            .unwrap();
        let message = Message::read_bhttp(&mut Cursor::new(&reply[..])).unwrap();
        assert_eq!(message.content(), b"/v1/ping");

        // The hour turns: a new key is published and the old one still answers.
        let turned = HOUR + ROTATE_SECS + 5;
        gateway.rotate(turned).unwrap();
        let new = gateway.key_config();
        assert_ne!(new, old);
        assert!(answer(&gateway, &ping(&old).0).is_ok());
        assert!(answer(&gateway, &ping(&new).0).is_ok());
        assert_eq!(key_files(&dir), 2);

        // A restart inside the overlap keeps both.
        let reloaded = Gateway::load(&dir, turned + 60).unwrap();
        assert!(answer(&reloaded, &ping(&old).0).is_ok());

        // Past the overlap the old key is refused as unknown and its file is gone.
        gateway.rotate(turned + OVERLAP_SECS).unwrap();
        assert_eq!(
            answer(&gateway, &ping(&old).0),
            Err(GatewayError::UnknownKey)
        );
        assert!(answer(&gateway, &ping(&new).0).is_ok());
        assert_eq!(key_files(&dir), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn garbage_is_invalid_not_a_key_problem() {
        let dir = scratch("garbage");
        let gateway = Gateway::load(&dir, HOUR).unwrap();
        assert_eq!(answer(&gateway, &[]), Err(GatewayError::Invalid));
        let mut request = ping(&gateway.key_config()).0;
        let last = request.len() - 1;
        request[last] ^= 1;
        assert_eq!(answer(&gateway, &request), Err(GatewayError::Invalid));
        fs::remove_dir_all(&dir).unwrap();
    }
}
