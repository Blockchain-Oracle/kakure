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
  /** Odds stay sealed until each side has the minimum (D3); only the total count moves meanwhile. */
  sealed: z.boolean(),
  ticketCount: z.number().int().nonnegative(),
  /** Totals as of the last release (only once unsealed, and only on min-new-ticket releases). */
  released: z.object({ seq: z.number().int().nonnegative(), sides: z.record(side, poolSideSchema) }).optional(),
  /** First block at or after the cutoff time, once it has the finality confirmations (plan §13.4). */
  cutoffHeight: z.number().int().positive().optional(),
  outcome: z.union([side, z.literal("refund")]).optional(),
  /** File name of the archived resolution evidence (raw venue responses or the chain read). */
  resolution: z.string().optional(),
  /** One merged, sorted list of ticket hashes; side and size live inside each hash (PD15). */
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

export type PoolSideRecord = z.infer<typeof poolSideSchema>;
export type MarketRules = z.infer<typeof marketRulesSchema>;
export type MarketState = z.infer<typeof marketStateSchema>;
export type Market = z.infer<typeof marketSchema>;
export type PayoutRun = z.infer<typeof payoutRunSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export type Latest = z.infer<typeof latestSchema>;
export type AddressList = z.infer<typeof addressListSchema>;
