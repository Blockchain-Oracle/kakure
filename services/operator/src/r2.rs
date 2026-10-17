//! Cloudflare R2 uploader (S3-compatible PUT with AWS Signature Version 4).
//!
//! Used only when all of `KAKURE_R2_ENDPOINT` (e.g. `https://<account>.r2.cloudflarestorage.com`),
//! `KAKURE_R2_BUCKET`, `KAKURE_R2_ACCESS_KEY_ID` and `KAKURE_R2_SECRET_ACCESS_KEY` are set.
//! Object keys are `<network>/<file>.json`, the data-worker's layout. The operator only pushes;
//! clients never talk to it (plan §2).

use anyhow::{Result, anyhow, bail, ensure};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac as _};
use secrecy::{ExposeSecret, SecretString};
use sha2::{Digest as _, Sha256};

const REGION: &str = "auto";
const SERVICE: &str = "s3";
const ENV_ENDPOINT: &str = "KAKURE_R2_ENDPOINT";
const ENV_BUCKET: &str = "KAKURE_R2_BUCKET";
const ENV_ACCESS_KEY: &str = "KAKURE_R2_ACCESS_KEY_ID";
const ENV_SECRET_KEY: &str = "KAKURE_R2_SECRET_ACCESS_KEY";

pub struct R2 {
    endpoint: String,
    host: String,
    bucket: String,
    access_key_id: String,
    secret: SecretString,
}

impl R2 {
    /// `None` when R2 is not configured; an error when it is only partly configured.
    pub fn from_env() -> Result<Option<Self>> {
        let get = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        let values = [
            get(ENV_ENDPOINT),
            get(ENV_BUCKET),
            get(ENV_ACCESS_KEY),
            get(ENV_SECRET_KEY),
        ];
        if values.iter().all(Option::is_none) {
            return Ok(None);
        }
        let [
            Some(endpoint),
            Some(bucket),
            Some(access_key_id),
            Some(secret),
        ] = values
        else {
            bail!(
                "R2 is partly configured: set all of {ENV_ENDPOINT}, {ENV_BUCKET}, {ENV_ACCESS_KEY}, {ENV_SECRET_KEY}"
            );
        };
        let endpoint = endpoint.trim_end_matches('/').to_string();
        let host = endpoint
            .strip_prefix("https://")
            .ok_or_else(|| anyhow!("{ENV_ENDPOINT} must start with https://"))?
            .to_string();
        ensure!(
            !host.contains('/'),
            "{ENV_ENDPOINT} must be an origin, without a path"
        );
        Ok(Some(Self {
            endpoint,
            host,
            bucket,
            access_key_id,
            secret: SecretString::new(secret),
        }))
    }

    pub fn describe(&self) -> String {
        format!("{}/{}", self.host, self.bucket)
    }

    /// PUTs one object.
    pub async fn put(&self, http: &reqwest::Client, key: &str, body: Vec<u8>) -> Result<()> {
        let path = format!("/{}/{}", uri_encode(&self.bucket), uri_encode_path(key));
        let payload_hash = hex::encode(Sha256::digest(&body));
        let now = Utc::now();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let content_type = "application/json; charset=utf-8";
        let headers = [
            ("content-type", content_type),
            ("host", self.host.as_str()),
            ("x-amz-content-sha256", payload_hash.as_str()),
            ("x-amz-date", amz_date.as_str()),
        ];
        let authorization = authorization(
            &Request {
                method: "PUT",
                path: &path,
                headers: &headers,
                payload_hash: &payload_hash,
            },
            &now,
            REGION,
            &self.access_key_id,
            self.secret.expose_secret(),
        );
        let response = http
            .put(format!("{}{path}", self.endpoint))
            .header("content-type", content_type)
            .header("x-amz-content-sha256", &payload_hash)
            .header("x-amz-date", &amz_date)
            .header("authorization", authorization)
            .body(body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            bail!(
                "R2 PUT {key}: HTTP {status}: {}",
                text.chars().take(300).collect::<String>()
            );
        }
        Ok(())
    }
}

struct Request<'a> {
    method: &'a str,
    path: &'a str,
    /// Lower-case names, sorted, every one of them signed.
    headers: &'a [(&'a str, &'a str)],
    payload_hash: &'a str,
}

/// The SigV4 `Authorization` header (no query string; all given headers signed).
fn authorization(
    request: &Request<'_>,
    at: &DateTime<Utc>,
    region: &str,
    access_key_id: &str,
    secret: &str,
) -> String {
    let amz_date = at.format("%Y%m%dT%H%M%SZ").to_string();
    let date = at.format("%Y%m%d").to_string();
    let canonical_headers: String = request
        .headers
        .iter()
        .map(|(name, value)| format!("{name}:{}\n", value.trim()))
        .collect();
    let signed_headers = request
        .headers
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request = format!(
        "{}\n{}\n\n{canonical_headers}\n{signed_headers}\n{}",
        request.method, request.path, request.payload_hash
    );
    let scope = format!("{date}/{region}/{SERVICE}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let mut key = hmac(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    for part in [region, SERVICE, "aws4_request"] {
        key = hmac(&key, part.as_bytes());
    }
    let signature = hex::encode(hmac(&key, string_to_sign.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC takes any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// RFC 3986 unreserved characters pass; everything else is percent-encoded (SigV4 rules).
fn uri_encode(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn uri_encode_path(key: &str) -> String {
    key.split('/').map(uri_encode).collect::<Vec<_>>().join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone as _;

    /// The "GET Object" example from the AWS S3 SigV4 documentation (header-based auth).
    #[test]
    fn aws_documentation_example() {
        let at = Utc.with_ymd_and_hms(2013, 5, 24, 0, 0, 0).unwrap();
        let empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let header = authorization(
            &Request {
                method: "GET",
                path: "/test.txt",
                headers: &[
                    ("host", "examplebucket.s3.amazonaws.com"),
                    ("range", "bytes=0-9"),
                    ("x-amz-content-sha256", empty),
                    ("x-amz-date", "20130524T000000Z"),
                ],
                payload_hash: empty,
            },
            &at,
            "us-east-1",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        );
        assert!(header.ends_with(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        ));
    }

    #[test]
    fn encodes_keys() {
        assert_eq!(
            uri_encode_path("testnet/bundle-1.json"),
            "testnet/bundle-1.json"
        );
        assert_eq!(uri_encode("a b+c"), "a%20b%2Bc");
    }
}
