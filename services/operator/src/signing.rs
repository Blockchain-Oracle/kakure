//! Canonical JSON, the operator's Ed25519 signing key, and the hashes of published files.
//!
//! Byte-for-byte mirror of `packages/signing`: object keys sorted by UTF-16 code units, no
//! whitespace, strings escaped exactly as `JSON.stringify` does, safe integers only (amounts
//! travel as decimal strings). `packages/domain/fixtures/signing.json` keeps both sides equal.

use std::{
    cmp::Ordering,
    fmt::Write as _,
    fs,
    io::Write as _,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer as _, SigningKey, Verifier as _, VerifyingKey};
use rand::{TryRng as _, rngs::SysRng};
use secrecy::Zeroize;
use serde_json::{Map, Value};
use sha2::{Digest as _, Sha256};

use crate::domain::RULES_HASH_PERSONAL;

/// The field that carries the signature; the signed message is the document without it.
pub const SIGNATURE_FIELD: &str = "sig";
const SECRET_KEY_BYTES: usize = 32;
/// `Number.MAX_SAFE_INTEGER`: larger integers lose precision in JavaScript.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Canonical JSON of `value` (see the module docs).
pub fn canonical_json(value: &Value) -> Result<String> {
    let mut out = String::new();
    write_canonical(value, &mut out)?;
    Ok(out)
}

fn write_canonical(value: &Value, out: &mut String) -> Result<()> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&safe_integer(n)?.to_string()),
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|(a, _), (b, _)| utf16_cmp(a, b));
            out.push('{');
            for (i, (key, item)) in entries.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_canonical(item, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// JavaScript accepts any number that `Number.isSafeInteger` accepts, including `1.0` and `-0`.
fn safe_integer(n: &serde_json::Number) -> Result<i64> {
    let bound = i64::try_from(MAX_SAFE_INTEGER).expect("2^53 fits i64");
    let value = if let Some(i) = n.as_i64() {
        i
    } else if let Some(u) = n.as_u64() {
        i64::try_from(u).map_err(|_| anyhow!("unsafe integer {u}"))?
    } else {
        let f = n.as_f64().ok_or_else(|| anyhow!("bad number {n}"))?;
        ensure!(
            f.fract() == 0.0 && f.abs() <= MAX_SAFE_INTEGER as f64,
            "only safe integers can be signed (got {n}); send amounts as strings"
        );
        f as i64
    };
    ensure!(
        (-bound..=bound).contains(&value),
        "only safe integers can be signed (got {value}); send amounts as strings"
    );
    Ok(value)
}

/// `JSON.stringify` string escaping: `"`, `\`, and C0 controls (short forms where JSON has them,
/// lowercase `\u00xx` otherwise); everything else is written as is.
fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => {
                write!(out, "\\u{:04x}", u32::from(c)).expect("writing to a String");
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// JavaScript sorts strings by UTF-16 code units, which differs from UTF-8 byte order above U+FFFF.
fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// The signed message: canonical JSON of the document without its `sig` field, as UTF-8.
pub fn signing_input(document: &Value) -> Result<Vec<u8>> {
    let mut unsigned: Map<String, Value> = document
        .as_object()
        .ok_or_else(|| anyhow!("only objects are signed"))?
        .clone();
    unsigned.remove(SIGNATURE_FIELD);
    Ok(canonical_json(&Value::Object(unsigned))?.into_bytes())
}

/// The operator's Ed25519 key. Ed25519 is deterministic, so a document always gets the same signature.
pub struct Keypair(SigningKey);

impl Keypair {
    pub fn from_secret(secret: &[u8; SECRET_KEY_BYTES]) -> Self {
        Self(SigningKey::from_bytes(secret))
    }

    pub fn public(&self) -> [u8; 32] {
        self.0.verifying_key().to_bytes()
    }

    /// Returns `document` with `sig` set (unpadded base64url of the 64-byte signature).
    pub fn sign(&self, document: &Value) -> Result<Value> {
        let signature = self.0.sign(&signing_input(document)?);
        let mut signed = document.clone();
        signed
            .as_object_mut()
            .expect("signing_input checked for an object")
            .insert(
                SIGNATURE_FIELD.into(),
                Value::String(URL_SAFE_NO_PAD.encode(signature.to_bytes())),
            );
        Ok(signed)
    }
}

/// Verifies a published document against a pinned public key.
pub fn verify(document: &Value, public: &[u8; 32]) -> Result<()> {
    let sig = document
        .get(SIGNATURE_FIELD)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("document has no signature"))?;
    let bytes: [u8; 64] = URL_SAFE_NO_PAD
        .decode(sig)?
        .try_into()
        .map_err(|_| anyhow!("signature must be 64 bytes"))?;
    VerifyingKey::from_bytes(public)?
        .verify(&signing_input(document)?, &Signature::from_bytes(&bytes))
        .map_err(|_| anyhow!("signature does not verify"))
}

/// `signing.key` in the network's data dir: the 32-byte secret as hex, mode 0600, never printed.
pub fn key_path(data_dir: &Path) -> PathBuf {
    data_dir.join("signing.key")
}

/// Creates a new key; refuses to overwrite one (clients pin the public key in their builds).
pub fn keygen(data_dir: &Path) -> Result<Keypair> {
    let path = key_path(data_dir);
    ensure!(
        !path.exists(),
        "{} already exists; refusing to replace a pinned key",
        path.display()
    );
    fs::create_dir_all(data_dir)?;
    let mut secret = [0u8; SECRET_KEY_BYTES];
    SysRng
        .try_fill_bytes(&mut secret)
        .map_err(|e| anyhow!("system RNG: {e}"))?;
    let mut text = hex::encode(secret);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .with_context(|| format!("creating {}", path.display()))?;
    let written = file
        .write_all(text.as_bytes())
        .and_then(|()| file.write_all(b"\n"))
        .and_then(|()| file.sync_all());
    text.zeroize();
    written?;
    let key = Keypair::from_secret(&secret);
    secret.zeroize();
    Ok(key)
}

pub fn load(data_dir: &Path) -> Result<Keypair> {
    let path = key_path(data_dir);
    let mut text = fs::read_to_string(&path)
        .with_context(|| format!("no signing key at {} (run keygen)", path.display()))?;
    let decoded = hex::decode(text.trim());
    text.zeroize();
    let mut bytes = decoded.context("signing.key is not hex")?;
    let Ok(mut secret) = <[u8; SECRET_KEY_BYTES]>::try_from(bytes.as_slice()) else {
        bytes.zeroize();
        bail!("signing.key must hold 32 bytes");
    };
    bytes.zeroize();
    let key = Keypair::from_secret(&secret);
    secret.zeroize();
    Ok(key)
}

/// `rulesHash`: BLAKE2b-256 (personal `Kakure_Rules_v01`) of the canonical rules JSON (D13).
pub fn rules_hash(rules: &Value) -> Result<String> {
    let hash = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(RULES_HASH_PERSONAL)
        .hash(canonical_json(rules)?.as_bytes());
    Ok(hex::encode(hash.as_bytes()))
}

/// `bundleHash`, `previous` and the address-list file names: SHA-256 hex of the exact file bytes.
pub fn file_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = include_str!("../../../packages/domain/fixtures/signing.json");

    fn fixture_key(fixtures: &Value) -> Keypair {
        let secret: [u8; 32] = hex::decode(fixtures["secretKeyHex"].as_str().expect("secret"))
            .expect("hex")
            .try_into()
            .expect("32 bytes");
        Keypair::from_secret(&secret)
    }

    #[test]
    fn matches_typescript_signatures() {
        let fixtures: Value = serde_json::from_str(FIXTURES).expect("fixtures parse");
        let key = fixture_key(&fixtures);
        let public = key.public();
        assert_eq!(
            hex::encode(public),
            fixtures["publicKeyHex"].as_str().expect("public")
        );
        for case in fixtures["documents"].as_array().expect("documents") {
            let name = case["name"].as_str().expect("name");
            let document = &case["document"];
            assert_eq!(
                canonical_json(document).expect("canonical"),
                case["canonical"].as_str().expect("canonical"),
                "canonical bytes differ for {name}"
            );
            let signed = key.sign(document).expect("signs");
            assert_eq!(
                signed[SIGNATURE_FIELD], case["sig"],
                "signature differs for {name}"
            );
            verify(&signed, &public).expect("verifies");
            let mut tampered = signed.clone();
            tampered["tampered"] = Value::Bool(true);
            assert!(verify(&tampered, &public).is_err(), "tamper on {name}");
        }
        for case in fixtures["rulesHashes"].as_array().expect("rules") {
            assert_eq!(
                rules_hash(&case["rules"]).expect("hash"),
                case["rulesHash"].as_str().expect("rulesHash")
            );
        }
        for case in fixtures["fileHashes"].as_array().expect("files") {
            assert_eq!(
                file_hash(case["text"].as_str().expect("text").as_bytes()),
                case["sha256"].as_str().expect("sha256")
            );
        }
    }

    #[test]
    fn refuses_floats_and_unsafe_integers() {
        assert!(canonical_json(&serde_json::json!({ "amount": 0.1 })).is_err());
        assert!(
            canonical_json(&serde_json::json!({ "amount": 9_007_199_254_740_992_u64 })).is_err()
        );
        assert_eq!(
            canonical_json(&serde_json::json!({ "b": 1.0, "a": -0.0 })).expect("integral"),
            r#"{"a":0,"b":1}"#
        );
    }
}
