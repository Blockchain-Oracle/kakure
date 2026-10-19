//! The trading API's HTTP surface (plan §00 REVAMP 2): `GET /ohttp-keys` and `POST /gateway`.
//!
//! Nothing else is reachable from outside: every API call is an encrypted `message/ohttp-req`
//! the data worker relays to `/gateway`, decrypted by `gateway.rs` and dispatched here by method
//! and path. No logs record requests, addresses or timing; the server binds to
//! `KAKURE_GATEWAY_ADDR` (default `127.0.0.1:8790`; `0.0.0.0:8790` behind Traefik on the server).

use std::sync::Arc;

use anyhow::{Context, Result};
use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::json;

use crate::gateway::{Gateway, Inner, MAX_MESSAGE_BYTES, Reply};

pub const DEFAULT_ADDR: &str = "127.0.0.1:8790";

struct Api {
    gateway: Gateway,
    network: &'static str,
}

/// Serves the gateway until the process ends.
pub async fn serve(gateway: Gateway, network: &'static str) -> Result<()> {
    let addr = std::env::var("KAKURE_GATEWAY_ADDR").unwrap_or_else(|_| DEFAULT_ADDR.to_string());
    let state = Arc::new(Api { gateway, network });
    let app = Router::new()
        .route("/ohttp-keys", get(keys))
        .route("/gateway", post(relay))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_MESSAGE_BYTES))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("binding {addr}"))?;
    eprintln!("gateway: listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn keys(State(api): State<Arc<Api>>) -> Response {
    let mut response = api.gateway.key_config().to_vec().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/ohttp-keys"),
    );
    response
}

async fn relay(State(api): State<Arc<Api>>, body: Bytes) -> Response {
    match api.gateway.handle(&body, |inner| route(&api, inner)) {
        Ok(bytes) => {
            let mut response = bytes.into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("message/ohttp-res"),
            );
            response
        }
        // RFC 9458 §5.2: an undecryptable request gets a plain error, never details.
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

/// The inner API, by method and path.
fn route(api: &Api, inner: Inner) -> Reply {
    match (inner.method.as_str(), inner.path.as_str()) {
        ("GET", "/v1/ping") => json_reply(200, &json!({ "ok": true, "network": api.network })),
        ("POST", "/v1/ping") => {
            let echo = String::from_utf8_lossy(&inner.body).into_owned();
            json_reply(
                200,
                &json!({ "ok": true, "network": api.network, "echo": echo }),
            )
        }
        _ => json_reply(404, &json!({ "error": "not found" })),
    }
}

fn json_reply(status: u16, body: &serde_json::Value) -> Reply {
    Reply {
        status,
        body: body.to_string().into_bytes(),
    }
}
