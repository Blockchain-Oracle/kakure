# Kakure operator: one process per network, outbound-only. It talks to public light-wallet servers over embedded Tor
# (Arti) and to price venues over HTTPS; nothing connects to it, so it has no port and no public route. All state
# lives in the operator-data volume.
#
# Cut-over, phase 1 of 2: this build drains the pool-era engine (`run --drain`): it lists no new markets and finishes
# the open ones (resolve, refund, schedule payouts), logging "drain: …" each tick. Once it logs that every pool market
# is resolved, roll to the next build, which runs the real-time market (`serve`) and sends what is still scheduled.

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
ENTRYPOINT ["kakure-operator"]
CMD ["run", "--network", "testnet", "--drain"]
