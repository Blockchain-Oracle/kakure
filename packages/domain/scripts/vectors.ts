/**
 * Writes fixtures/vectors.json: memo, ticket-hash and payout cases computed by this (reference) package.
 * The Rust operator's test reads the same file, so both implementations must agree byte for byte.
 * Run: pnpm --filter @kakure/domain vectors
 */
import { writeFileSync } from "node:fs";
import { TICKET_SIZES_ZAT } from "../src/constants";
import { encodeBetMemo } from "../src/memo";
import { canonicalNotes, payoutZat } from "../src/payout";
import { ticketHashHex } from "../src/ticket";

// Real Orchard-only addresses from the S00 smoke test (testnet) — the Rust side decodes them for PD18.
const TESTNET_A =
  "utest15a2u8lfvhtc8zuy9jh8mj7cawp7thxr0gjsyl9r4nqa7lrp7wrlcnaqpnenu0z92kzkf2j4j7e6qx6u507gl5wh9uvj95k45dv55vjgd";
const TESTNET_B =
  "utest1mfrx6suz2urywesnq6u5y09n5njsv5yctgk44e5wp0tk8wyk97yr8xf5wt6zjdxelkqu663jeflflyxc2amktcflw03xjpfmjcgmy0w7";

const nonce = (seed: number) => Uint8Array.from({ length: 16 }, (_, index) => (seed * 31 + index * 7) % 256);

const bets = [
  {
    network: "testnet",
    marketId: "btc-1h-2610171600",
    side: "U",
    sizeZat: 1_000_000n,
    nonce: nonce(1),
    payoutAddress: TESTNET_A,
  },
  {
    network: "testnet",
    marketId: "zec-1d-2610180000",
    side: "D",
    sizeZat: 100_000_000n,
    nonce: nonce(2),
    payoutAddress: TESTNET_B,
  },
  {
    network: "testnet",
    marketId: "evt-tnh-2610200000",
    side: "Y",
    sizeZat: 50_000_000n,
    nonce: nonce(3),
    payoutAddress: TESTNET_A,
  },
] as const;

const memos = bets.map((bet) => ({ memo: encodeBetMemo(bet), ticketHash: ticketHashHex(bet) }));

const pools: Array<[bigint, bigint]> = [
  [3_000_000n, 3_000_000n],
  [7_000_000n, 3_000_000n],
  [300_000_000n, 1_250_000_000n],
  [10_000_000_000_000n, 10_000_000_000_000n],
];
const payouts = TICKET_SIZES_ZAT.flatMap((sizeZat) =>
  pools.map(([winningPoolZat, losingPoolZat]) => {
    const payout = payoutZat(sizeZat, winningPoolZat, losingPoolZat);
    return {
      sizeZat: sizeZat.toString(),
      winningPoolZat: winningPoolZat.toString(),
      losingPoolZat: losingPoolZat.toString(),
      payoutZat: payout.toString(),
      notes: canonicalNotes(payout).map(String),
    };
  }),
);

const target = new URL("../fixtures/vectors.json", import.meta.url);
writeFileSync(target, `${JSON.stringify({ memos, payouts }, null, 2)}\n`);
console.log(`wrote ${memos.length} memo cases and ${payouts.length} payout cases`);
