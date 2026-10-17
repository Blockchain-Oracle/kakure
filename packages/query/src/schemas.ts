import {
  type AddressList,
  type Bundle,
  CLOSE_SIDES,
  type SCHEMA_VERSION as DOMAIN_SCHEMA_VERSION,
  EVENT_SIDES,
  type Latest,
  MARKET_ID_PATTERN,
  NETWORKS,
  TICKET_HASH_BYTES,
} from "@kakure/domain";
import { z } from "zod/mini";

/**
 * The frozen v1 schemas from @kakure/domain (src/bundle.ts), re-expressed with `zod/mini` so the browser ships
 * a fraction of zod (plan §2 Budgets). Same rules, check for check. Two guards keep them identical:
 *   - the type assertions at the bottom fail the typecheck if the parsed shapes ever differ from domain's types;
 *   - `pnpm --filter @kakure/query parity` runs both schema sets over real and mutated files and compares verdicts.
 */

/**
 * The frozen format version, typed against domain's so it can't drift, but not imported at runtime: importing it
 * would load domain's full-zod schemas into the browser.
 */
export const SCHEMA_VERSION: typeof DOMAIN_SCHEMA_VERSION = 1;

const HEX_HASH = new RegExp(`^[0-9a-f]{${TICKET_HASH_BYTES * 2}}$`);
const ZAT = /^\d+$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

const network = z.enum(NETWORKS);
const isoTime = z.iso.datetime({ offset: false });
const zat = z.string().check(z.regex(ZAT));
const side = z.enum([...CLOSE_SIDES, ...EVENT_SIDES]);
const hexHash = z.string().check(z.regex(HEX_HASH));
const signature = z.string().check(z.regex(SIGNATURE));
const count = z.int().check(z.nonnegative());
const text = z.string().check(z.minLength(1));

const poolSide = z.object({ tickets: count, zat });

const marketRules = z.object({
  question: text,
  resolution: text,
  sources: z.array(text).check(z.minLength(1)),
  cancellation: text,
  payoutFormula: text,
});

const marketState = z.enum(["scheduled", "open", "closing", "closed", "resolving", "resolved", "refunding", "paid"]);

const market = z.object({
  id: z.string().check(z.regex(MARKET_ID_PATTERN)),
  kind: z.enum(["close", "event"]),
  subject: text,
  window: z.enum(["1h", "1d", "session", "event"]),
  opensAt: isoTime,
  cutoffAt: isoTime,
  closesAt: isoTime,
  rules: marketRules,
  rulesHash: hexHash,
  opening: z.optional(z.record(z.string(), z.string())),
  state: marketState,
  sealed: z.boolean(),
  ticketCount: count,
  released: z.optional(z.object({ seq: count, sides: z.partialRecord(side, poolSide) })),
  cutoffHeight: z.optional(z.int().check(z.positive())),
  outcome: z.optional(z.union([side, z.literal("refund")])),
  resolution: z.optional(z.string()),
  leaves: z.array(hexHash),
});

const payoutRun = z.object({ resolvedBefore: isoTime, allSentBy: isoTime });

export const bundleSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  seq: count,
  publishedAt: isoTime,
  previous: z.nullable(hexHash),
  addresses: text,
  markets: z.array(market),
  payoutRuns: z.array(payoutRun),
  history: z.optional(z.array(text)),
  sig: signature,
});

export const latestSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  seq: count,
  bundle: text,
  bundleHash: hexHash,
  publishedAt: isoTime,
  sig: signature,
});

export const addressListSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  network,
  seq: count,
  addresses: z.array(text).check(z.minLength(1)),
  sig: signature,
});

// ── The parsed shapes must equal domain's (a compile-time check; it fails `tsc` if they drift).
type Equal<A, B> = (<T>() => T extends A ? "yes" : "no") extends <T>() => T extends B ? "yes" : "no" ? true : false;
const sameShape = <T extends true>(proof: T) => proof;
sameShape<Equal<z.infer<typeof bundleSchema>, Bundle>>(true);
sameShape<Equal<z.infer<typeof latestSchema>, Latest>>(true);
sameShape<Equal<z.infer<typeof addressListSchema>, AddressList>>(true);
