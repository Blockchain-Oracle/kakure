import { z } from "zod";
import { CLOSE_SIDES, EVENT_SIDES, MARKET_ID_PATTERN, NETWORKS, TICKET_HASH_BYTES } from "./constants";

/**
 * The public files the operator signs and pushes to R2, and every client downloads the same way (PD14).
 * Version 1 is frozen in S01: the operator (Rust) writes exactly these shapes.
 * Amounts are decimal strings of zatoshi so JSON never carries floats or unsafe integers.
 */
export const SCHEMA_VERSION = 1;

const HEX_HASH = new RegExp(`^[0-9a-f]{${TICKET_HASH_BYTES * 2}}$`);
const ZAT = /^\d+$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/; // Ed25519, 64 bytes as unpadded base64url

const network = z.enum(NETWORKS);
const isoTime = z.iso.datetime({ offset: false });
const zat = z.string().regex(ZAT);
const side = z.enum([...CLOSE_SIDES, ...EVENT_SIDES]);

export const poolSideSchema = z.object({ tickets: z.number().int().nonnegative(), zat });

export const marketRulesSchema = z.object({
  /** Exact wording, the resolver, the sources and the cancellation cases, fixed before betting opens (D13). */
  question: z.string().min(1),
  resolution: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  cancellation: z.string().min(1),
  payoutFormula: z.string().min(1),
});

export const marketStateSchema = z.enum([
  "scheduled",
  "open",
  "closing",
  "closed", // betting over, waiting for finality and the close
  "resolving",
  "resolved",
  "refunding",
  "paid",
]);

export const marketSchema = z.object({
  id: z.string().regex(MARKET_ID_PATTERN),
  kind: z.enum(["close", "event"]),
  /** Ticker for close markets (BTC, AAPL); event key for event markets (nu7). */
  subject: z.string().min(1),
  window: z.enum(["1h", "1d", "session", "event"]),
  opensAt: isoTime,
  cutoffAt: isoTime,
  closesAt: isoTime,
  rules: marketRulesSchema,
  /** Hash of the canonical rules object, published before betting opens. */
  rulesHash: z.string().regex(HEX_HASH),
  /** Opening reference (close markets): the per-venue values the direction vote compares against. */
  opening: z.record(z.string(), z.string()).optional(),
  state: marketStateSchema,
  /** Odds stay sealed until each side has the minimum among the released tickets (D3). */
  sealed: z.boolean(),
  /**
   * Released tickets only (PD28): it changes only in releases of at least MIN_NEW_TICKETS_PER_RELEASE new tickets,
   * so no release singles out one bet. `leaves` and `released` describe the same set.
   */
  ticketCount: z.number().int().nonnegative(),
  /** Totals of the released tickets and the bundle that last changed them (only once unsealed). */
  released: z.object({ seq: z.number().int().nonnegative(), sides: z.partialRecord(side, poolSideSchema) }).optional(),
  /** First block at or after the cutoff time, once it has the finality confirmations (plan §13.4). */
  cutoffHeight: z.number().int().positive().optional(),
  outcome: z.union([side, z.literal("refund")]).optional(),
  /** File name of the archived resolution evidence (raw venue responses or the chain read). */
  resolution: z.string().optional(),
  /** The released tickets' hashes, merged and sorted; side and size live inside each hash (PD15, PD28). */
  leaves: z.array(z.string().regex(HEX_HASH)),
});

export const payoutRunSchema = z.object({
  /** Coarse status only: never txids (PD7, PD16). */
  resolvedBefore: isoTime,
  allSentBy: isoTime,
});

export const bundleSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  seq: z.number().int().nonnegative(),
  publishedAt: isoTime,
  previous: z.string().regex(HEX_HASH).nullable(),
  addresses: z.string().min(1),
  markets: z.array(marketSchema),
  payoutRuns: z.array(payoutRunSchema),
  /** The last days' `history-<yyyymmdd>.json` files, oldest first (added in S03; absent from earlier bundles). */
  history: z.array(z.string().min(1)).optional(),
  sig: z.string().regex(SIGNATURE),
});

export const latestSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  seq: z.number().int().nonnegative(),
  bundle: z.string().min(1),
  bundleHash: z.string().regex(HEX_HASH),
  publishedAt: isoTime,
  sig: z.string().regex(SIGNATURE),
});

export const addressListSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  seq: z.number().int().nonnegative(),
  /** Orchard-only diversified market addresses; the client picks one at random (D7). */
  addresses: z.array(z.string().min(1)).min(1),
  sig: z.string().regex(SIGNATURE),
});

const venueVoteSchema = z.object({
  venue: z.string().min(1),
  pair: z.string().min(1),
  /** The venue's opening reference and window-end close, exactly as printed (absent = no candle). */
  opening: z.string().optional(),
  close: z.string().optional(),
  vote: z.enum(["U", "D", "flat", "none"]),
});

const sourceResponseSchema = z.object({
  source: z.string().min(1),
  url: z.string().min(1),
  fetchedAt: isoTime,
  status: z.number().int(),
  /** The raw response body, byte for byte as received, so anyone can re-derive the vote. */
  body: z.string(),
});

const chainEvidenceSchema = z.object({
  server: z.string().min(1),
  targetHeight: z.number().int().positive().optional(),
  deadline: isoTime,
  blockHeight: z.number().int().positive(),
  blockHash: z.string().regex(HEX_HASH),
  blockTime: z.number().int(),
  medianTimePast: z.number().int(),
  tip: z.number().int().positive(),
  confirmations: z.number().int().positive(),
  branchId: z.string().optional(),
});

/**
 * `resolution-<marketId>.json`: the signed evidence of one resolution (plan §13.5). Close markets carry each
 * venue's vote and the raw venue responses with their fetch times; event markets carry the chain read.
 */
export const resolutionSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  market: z.string().regex(MARKET_ID_PATTERN),
  kind: z.enum(["close", "event"]),
  rulesHash: z.string().regex(HEX_HASH),
  resolvedAt: isoTime,
  /** H_c, frozen at FINALITY_CONFIRMATIONS; the totals are the signed final counts below it. */
  cutoffHeight: z.number().int().positive(),
  totals: z.partialRecord(side, poolSideSchema),
  /** What the sources say, or "none" (split, flat or missing votes) / "disagree" (chain servers differ). */
  direction: z.union([side, z.literal("none"), z.literal("disagree")]),
  /** What happens to the money: the winning side, or "refund". */
  outcome: z.union([side, z.literal("refund")]),
  reason: z.enum(["majority", "chain", "thin-pool", "no-majority", "cancelled", "servers-disagree"]),
  votes: z.array(venueVoteSchema).optional(),
  chain: chainEvidenceSchema.optional(),
  responses: z.array(sourceResponseSchema),
  sig: z.string().regex(SIGNATURE),
});

/**
 * `history-<yyyymmdd>.json`: one UTC day's price paths from each close market's primary venue (Coinbase),
 * 1-minute closes for hourly markets and 5-minute closes for daily ones, for the replay and recap films (C9).
 * Privacy (PD14): clients always download whole days, never one market's path, so a fetch reveals no interest.
 * Written once, after the day's markets resolve (published files are immutable).
 */
export const historySchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  day: z.iso.date(),
  markets: z.array(
    z.object({
      id: z.string().regex(MARKET_ID_PATTERN),
      subject: z.string().min(1),
      window: z.enum(["1h", "1d"]),
      venue: z.string().min(1),
      pair: z.string().min(1),
      interval: z.number().int().positive(),
      closes: z.array(z.tuple([z.number().int(), z.string().regex(/^\d+(\.\d+)?$/)])),
    }),
  ),
  sig: z.string().regex(SIGNATURE),
});

export type PoolSideRecord = z.infer<typeof poolSideSchema>;
export type MarketRules = z.infer<typeof marketRulesSchema>;
export type MarketState = z.infer<typeof marketStateSchema>;
export type Market = z.infer<typeof marketSchema>;
export type PayoutRun = z.infer<typeof payoutRunSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export type Latest = z.infer<typeof latestSchema>;
export type AddressList = z.infer<typeof addressListSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;
export type History = z.infer<typeof historySchema>;
