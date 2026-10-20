# Kakure operator: one process per network (`serve --network <testnet|mainnet>`), the real-time market (plan §00).
# Outbound, it reads light-wallet servers over embedded Tor (Arti), venue candles over HTTPS, the price relay's
# stream, and pushes its signed files to the data worker (KAKURE_PUSH_URL). Inbound, only the Oblivious HTTP gateway
# listens (KAKURE_GATEWAY_ADDR, port 8790): clients reach it through the relay on the data worker, which forwards only
# sealed bytes. Give it an HTTPS domain outside the relay's Cloudflare zone. All state lives in the operator-data
# volume. The pool-era engine (`run`) is still in the binary for draining old markets; it never runs beside `serve`
# on the same wallet.

FROM rust:1.98.1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked && cp target/release/kakure-operator /kakure-operator

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home kakure
COPY --from=build /kakure-operator /usr/local/bin/kakure-operator
USER kakure
WORKDIR /home/kakure
# operator-data/<network>/: wallet.sqlite, engine.sqlite, the mnemonic and signing key (mode 0600), Tor state and
# the signed public files. Mount it as a persistent volume and back it up off the server.
VOLUME ["/home/kakure/operator-data"]
ENV KAKURE_GATEWAY_ADDR=0.0.0.0:8790
EXPOSE 8790
ENTRYPOINT ["kakure-operator"]
CMD ["serve", "--network", "testnet"]
