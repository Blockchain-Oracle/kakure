import { z } from "zod";
import { CADENCES_SEC, LANE_ASSETS, NETWORKS, TICKET_HASH_BYTES, VENUE_KEYS, VENUES_PER_ASSET } from "./constants";
import { WINDOW_ID_PATTERN } from "./lanes";

/**
 * The real-time public files (plan §00 REVAMP 2), version 2. Every client downloads the same files the same way
 * (PD14) and checks the operator's signature before parsing (`@kakure/query` fetchSigned).
 *
 * - `latest.json`: the pointer, every minute.
 * - `bundle-<seq>.json`: the lanes, the pricing inputs (σ, spread, bounds), the Windows trading now and next with
 *   their opening prints, and the Windows settled in the last 10 minutes with every venue's prints and the outcome.
 * - `prints-<yyyymmddhh>.json`: written once an hour ends: every venue's 1-minute closes for each asset in that hour and
 *   every Window settled in it. The permanent evidence /verify recomputes outcomes from.
 *
 * Prices are decimal strings exactly as the venue printed them; no floats cross the wire.
 */
export const SCHEMA_VERSION_V2 = 2;

const HEX_HASH = new RegExp(`^[0-9a-f]{${TICKET_HASH_BYTES * 2}}$`);
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;
const PRINTS_FILE = /^prints-\d{10}\.json$/;
const BUNDLE_FILE = /^bundle-\d+\.json$/;

const network = z.enum(NETWORKS);
const isoTime = z.iso.datetime({ offset: false });
const decimal = z.string().regex(DECIMAL);
const venue = z.enum(VENUE_KEYS);
const asset = z.enum(LANE_ASSETS);
const signature = z.string().regex(SIGNATURE);

/** One venue's print for a boundary: the close of the 1-minute candle ending there, or null when it had no trades. */
export const venuePricesSchema = z.partialRecord(venue, decimal.nullable());

export const laneSchema = z.object({
  id: z.string(),
  asset,
  cadenceSec: z
    .number()
    .int()
    .refine((c) => (CADENCES_SEC as readonly number[]).includes(c)),
  phaseSec: z.number().int().nonnegative(),
  /** The three venues that print and vote for this asset, in vote order. */
  venues: z.array(venue).length(VENUES_PER_ASSET),
});

export const windowStateSchema = z.object({
  id: z.string().regex(WINDOW_ID_PATTERN),
  startsAt: isoTime,
  expiresAt: isoTime,
  /** Each venue's opening print, once its candle is committed. */
  opening: venuePricesSchema.optional(),
  /** The line the price formula uses: the median of the opening prints with trades. */
  reference: decimal.optional(),
  closing: venuePricesSchema.optional(),
  /** Up or Down when two of three venues agree; otherwise every position is refunded at cost. */
  outcome: z.enum(["U", "D", "refund"]).optional(),
  settledAt: isoTime.optional(),
});

export const pricingSchema = z.object({
  entryBufferSec: z.number().int().positive(),
  minTauSec: z.number().int().positive(),
  halfSpread: decimal,
  minAsk: decimal,
  maxAsk: decimal,
  /** Annualised σ per asset (a fraction: 0.52 = 52 %), realised over the relay's last 5 h of 1-minute closes. */
  sigma: z.partialRecord(asset, decimal),
  sigmaAt: isoTime,
});

export const bundleV2Schema = z.object({
  v: z.literal(SCHEMA_VERSION_V2),
  network,
  seq: z.number().int().nonnegative(),
  publishedAt: isoTime,
  previous: z.string().regex(HEX_HASH).nullable(),
  lanes: z.array(laneSchema),
  pricing: pricingSchema,
  windows: z.array(windowStateSchema),
  /** The hourly prints files published in the last 24 h, oldest first. */
  prints: z.array(z.string().regex(PRINTS_FILE)),
  sig: signature,
});

export const latestV2Schema = z.object({
  v: z.literal(SCHEMA_VERSION_V2),
  network,
  seq: z.number().int().nonnegative(),
  bundle: z.string().regex(BUNDLE_FILE),
  bundleHash: z.string().regex(HEX_HASH),
  publishedAt: isoTime,
  sig: signature,
});

/** `[minute start (unix seconds), close or null]`, oldest first. */
const minuteClose = z.tuple([z.number().int(), decimal.nullable()]);

export const printsSchema = z.object({
  v: z.literal(SCHEMA_VERSION_V2),
  network,
  /** The hour these prints cover, `[hour, hour + 1 h)`. */
  hour: isoTime,
  closes: z.partialRecord(asset, z.partialRecord(venue, z.array(minuteClose))),
  windows: z.array(windowStateSchema),
  sig: signature,
});

export type VenuePrices = z.infer<typeof venuePricesSchema>;
export type LaneInfo = z.infer<typeof laneSchema>;
export type WindowState = z.infer<typeof windowStateSchema>;
export type Pricing = z.infer<typeof pricingSchema>;
export type BundleV2 = z.infer<typeof bundleV2Schema>;
export type LatestV2 = z.infer<typeof latestV2Schema>;
export type Prints = z.infer<typeof printsSchema>;
