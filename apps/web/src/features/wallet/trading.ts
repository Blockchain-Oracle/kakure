"use client";

import { type Network, parseWindowId, type Trading, toHex } from "@kakure/domain";
import {
  type BlindSignature,
  finishBlank,
  finishOutputs,
  ladderBlankCount,
  newSecret,
  prepareBlank,
  prepareOutputs,
  select,
  total,
} from "@kakure/ecash";
import { operatorKey } from "@kakure/query";
import { verifyDocument } from "@kakure/signing";
import { DATA_SOURCE } from "@/constants";
import { MINT_CODES, MintError, mintCall } from "./api";
import type { ExitPlan, PositionCertificate, PositionRecord } from "./records";
import { apply, chipRecords, current, exclusive, keysetOf, restore, stillUnspent, store } from "./wallet-store";

/**
 * Trading against the house (plan §00 T3 contract), on this device's chips. A position is keyed by its lock, the
 * SHA-256 of a secret drawn here; the secret is the position's bearer authority and never leaves the device except to
 * the mint, inside OHTTP, to close, redeem or arm an exit. Every request is saved with the position before it's sent
 * (`pending`), so a closed tab resends it byte for byte and the mint answers from its cache: a buy never loses its
 * chips, a close never loses its proceeds.
 *
 * Proceeds arrive on blank outputs (the mint picks the amounts), each chip DLEQ-checked against the published keyset.
 */
const HEX_PAIR = 2;
const HEX = 16;

async function lockOf(secret: string): Promise<string> {
  const bytes = new Uint8Array(secret.length / HEX_PAIR);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(secret.slice(i * HEX_PAIR, i * HEX_PAIR + HEX_PAIR), HEX);
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** A certificate is kept only once the operator's pinned key verifies it. */
function verified(network: Network, certificate: unknown): PositionCertificate {
  const key = operatorKey(DATA_SOURCE, network);
  if (!key || !verifyDocument(certificate as Record<string, unknown>, key)) {
    throw new Error("The position's certificate isn't signed by the operator.");
  }
  return certificate as PositionCertificate;
}

async function find(network: Network, key: string): Promise<PositionRecord> {
  const record = (await current(network)).positions.find((p) => p.key === key);
  if (!record) throw new Error("This position isn't on this device.");
  return record;
}

/* ── Buying ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface SingleOrder {
  window: string;
  side: "U" | "D";
  stakeZat: number;
  /** The worst ask accepted: the quote plus the slippage tolerance (`withSlippage`). */
  maxAskE4: number;
  /** The asset price seen when buying, kept on this device for the chart. */
  entrySpot?: number;
}

/** A band (Range, Moonshot): the close inside [lo, hi] or outside it; a missing edge is unbounded. */
export interface BandOrder {
  window: string;
  lo: string | null;
  hi: string | null;
  side: "in" | "out";
  stakeZat: number;
  /** The worst ask accepted: the quote plus the slippage tolerance (`withSlippage`). */
  maxAskE4: number;
  entrySpot?: number;
}

export interface ParlayOrder {
  legs: { window: string; side: "U" | "D" }[];
  stakeZat: number;
  maxPriceE8: number;
}

/** Buys one Window side. Throws a MintError on a refusal (the chips are back in the balance). */
export function buy(network: Network, trading: Trading, order: SingleOrder): Promise<PositionRecord> {
  const { stakeZat, entrySpot, ...rest } = order;
  return exclusive(network, () => place(network, trading, "/v1/trade", rest, stakeZat, entrySpot));
}

/** Buys a band side. Throws a MintError on a refusal (the chips are back in the balance). */
export function buyBand(network: Network, trading: Trading, order: BandOrder): Promise<PositionRecord> {
  const { stakeZat, entrySpot, ...rest } = order;
  return exclusive(network, () => place(network, trading, "/v1/band", rest, stakeZat, entrySpot));
}

/** Buys a parlay of 2–3 legs, all or nothing. */
export function buyParlay(network: Network, trading: Trading, order: ParlayOrder): Promise<PositionRecord> {
  const { stakeZat, ...rest } = order;
  return exclusive(network, () => place(network, trading, "/v1/parlay", rest, stakeZat));
}

async function place(
  network: Network,
  trading: Trading,
  path: "/v1/trade" | "/v1/parlay" | "/v1/band",
  body: object,
  stakeZat: number,
  entrySpot?: number,
): Promise<PositionRecord> {
  const keyset = keysetOf(trading);
  const wallet = await current(network);
  const inputs = select(
    wallet.chips.map((chip) => chip.proof),
    stakeZat,
  );
  if (!inputs) throw new Error("Not enough chips for that stake. Deposit more on Portfolio.");
  const change = total(inputs) > stakeZat ? prepareOutputs(keyset, total(inputs) - stakeZat) : null;
  const secret = newSecret();
  const key = await lockOf(secret);
  const sent = body as { maxAskE4?: number; maxPriceE8?: number };
  const limit =
    sent.maxAskE4 !== undefined
      ? { askE4: sent.maxAskE4 }
      : sent.maxPriceE8 !== undefined
        ? { priceE8: sent.maxPriceE8 }
        : undefined;
  const record: PositionRecord = {
    kind: "position",
    network,
    key,
    secret,
    createdAt: Date.now(),
    state: "buying",
    ...(entrySpot === undefined ? {} : { entrySpot }),
    ...(limit ? { limit } : {}),
    pending: {
      path,
      request: JSON.stringify({ ...body, inputs, change: change?.outputs ?? [], lock: key }),
      inputs,
      ...(change ? { change: store(change) } : {}),
    },
  };
  // Saved, and the inputs out of the balance, before the request leaves.
  await apply(network, [record], chipRecords(network, inputs));
  return settle(network, trading, record);
}

/* ── Settling a request in flight ────────────────────────────────────────────────────────────────────────────── */

interface Proceeds {
  valueZat: string;
  signatures: BlindSignature[];
}

/** Sends (or resends) a position's pending request and records its answer. */
async function settle(network: Network, trading: Trading, record: PositionRecord): Promise<PositionRecord> {
  const pending = record.pending;
  if (!pending) return record;
  const keyset = keysetOf(trading);
  const { pending: _, ...rest } = record;
  try {
    const answer = await mintCall<{
      position?: unknown;
      change?: BlindSignature[];
      valueZat?: string;
      signatures?: BlindSignature[];
      state?: string;
    }>(network, trading, "POST", pending.path, pending.request);
    if (pending.path === "/v1/trade" || pending.path === "/v1/parlay" || pending.path === "/v1/band") {
      const certificate = verified(network, answer.position);
      const change = pending.change ? finishOutputs(keyset, restore(pending.change), answer.change ?? []) : [];
      const next: PositionRecord = { ...rest, state: "open", certificate };
      await apply(network, [...chipRecords(network, change), next]);
      return next;
    }
    if (pending.path === "/v1/exit") {
      const next: PositionRecord =
        answer.state === "armed"
          ? { ...rest, state: "armed", ...(pending.blank ? { exitBlank: pending.blank } : {}) }
          : { ...rest, state: "open" };
      if (next.state === "open") {
        delete next.exit;
        delete next.exitBlank;
      }
      await apply(network, [next]);
      return next;
    }
    const { valueZat, signatures } = answer as Proceeds;
    const chips = pending.blank ? finishBlank(keyset, restore(pending.blank), signatures, Number(valueZat)) : [];
    if (pending.path === "/v1/close" && answer.position) {
      // Reduce: the same position on what's left, signed again; the share sold is history.
      const certificate = verified(network, answer.position);
      const before = Number(record.certificate?.stakeZat ?? 0);
      const asked = (JSON.parse(pending.request) as { fractionBps?: number }).fractionBps;
      const next: PositionRecord = {
        ...rest,
        state: record.exitBlank ? "armed" : "open",
        certificate,
        reductions: [
          ...(rest.reductions ?? []),
          {
            at: Date.now(),
            paidZat: valueZat,
            stakeZat: String(before - Number(certificate.stakeZat)),
            ...(asked === undefined ? {} : { fractionBps: asked }),
            ...(record.certificate ? { from: record.certificate } : {}),
          },
        ],
      };
      await apply(network, [...chipRecords(network, chips), next]);
      return next;
    }
    const next: PositionRecord = {
      ...rest,
      state: "paid",
      paidZat: valueZat,
      how: pending.path === "/v1/close" ? "close" : "redeem",
      paidAt: Date.now(),
    };
    await apply(network, [...chipRecords(network, chips), next]);
    return next;
  } catch (error) {
    if (!(error instanceof MintError && error.refused)) throw error;
    if (pending.inputs) {
      // A refused buy spent nothing (unless another device spent the same chips): they come back.
      const back = await stillUnspent(network, trading, pending.inputs, error);
      await apply(network, chipRecords(network, back), [record]);
    } else if (error.code === MINT_CODES.paid) {
      // An exit fired, or the mint redeemed it at settlement, before this request: collect that instead.
      await apply(network, [{ ...rest, state: "armed" }]);
      await collectOne(network, trading, { ...rest, state: "armed" });
    } else {
      // Back as it was before this request: armed if an exit was already waiting, otherwise open without one.
      const back: PositionRecord = { ...rest, state: record.exitBlank ? "armed" : "open" };
      if (!record.exitBlank) delete back.exit;
      await apply(network, [back]);
    }
    throw error;
  }
}

/* ── Close, redeem, exits ────────────────────────────────────────────────────────────────────────────────────── */

async function withBlank(
  network: Network,
  trading: Trading,
  key: string,
  path: "/v1/close" | "/v1/redeem" | "/v1/exit",
  body: object,
): Promise<PositionRecord> {
  const record = await find(network, key);
  if (!record.certificate || (record.state !== "open" && record.state !== "armed")) {
    throw new Error("This position isn't open.");
  }
  const blank = prepareBlank(keysetOf(trading), ladderBlankCount(trading.keyset));
  const next: PositionRecord = {
    ...record,
    pending: {
      path,
      request: JSON.stringify({
        position: record.certificate.id,
        secret: record.secret,
        ...body,
        outputs: blank.outputs,
      }),
      blank: store(blank),
    },
  };
  await apply(network, [next]);
  return settle(network, trading, next);
}

/** Sells a position back at the live bid (no lower than `minBidE4`): all of it, or `fractionBps` of it (Reduce). */
export function close(
  network: Network,
  trading: Trading,
  key: string,
  minBidE4: number,
  fractionBps?: number,
): Promise<PositionRecord> {
  const share = fractionBps === undefined ? {} : { fractionBps };
  return exclusive(network, () => withBlank(network, trading, key, "/v1/close", { minBidE4, ...share }));
}

/** Collects a settled position's payout (a win pays its payout, a refund its stake, a loss nothing). */
export function redeem(network: Network, trading: Trading, key: string): Promise<PositionRecord> {
  return exclusive(network, () => withBlank(network, trading, key, "/v1/redeem", {}));
}

/** Arms a trail, a stop or a take-profit at the mint: it fires with this tab closed. */
export function armExit(network: Network, trading: Trading, key: string, plan: ExitPlan): Promise<PositionRecord> {
  return exclusive(network, async () => {
    const record = await find(network, key);
    await apply(network, [{ ...record, exit: plan }]);
    return withBlank(network, trading, key, "/v1/exit", plan);
  });
}

export function disarmExit(network: Network, trading: Trading, key: string): Promise<PositionRecord> {
  return exclusive(network, async () => {
    const record = await find(network, key);
    if (!record.certificate || record.state !== "armed") return record;
    const next: PositionRecord = {
      ...record,
      pending: {
        path: "/v1/exit",
        request: JSON.stringify({ position: record.certificate.id, secret: record.secret, cancel: true }),
      },
    };
    await apply(network, [next]);
    return settle(network, trading, next);
  });
}

/** Asks the mint whether an armed position's exit fired (or it settled), and collects the proceeds if so. */
export function collect(network: Network, trading: Trading, key: string): Promise<PositionRecord> {
  return exclusive(network, async () => collectOne(network, trading, await find(network, key)));
}

async function collectOne(network: Network, trading: Trading, record: PositionRecord): Promise<PositionRecord> {
  if (!record.certificate) return record;
  const answer = await mintCall<{
    state: string;
    how: string | null;
    paidZat: string | null;
    signatures: BlindSignature[];
  }>(
    network,
    trading,
    "POST",
    "/v1/position",
    JSON.stringify({ position: record.certificate.id, secret: record.secret }),
  );
  if (answer.state === "open" || answer.state === "armed" || answer.paidZat === null) return record;
  const chips =
    record.exitBlank && answer.signatures.length > 0
      ? finishBlank(keysetOf(trading), restore(record.exitBlank), answer.signatures, Number(answer.paidZat))
      : [];
  const next: PositionRecord = {
    ...record,
    state: "paid",
    paidZat: answer.paidZat,
    how: answer.how ?? "settled",
    paidAt: Date.now(),
  };
  delete next.exitBlank;
  await apply(network, [...chipRecords(network, chips), next]);
  return next;
}

/** When a position's last Window expires (unix seconds). */
export function lastExpiry(certificate: PositionCertificate): number {
  if (certificate.legs) return Math.max(...certificate.legs.map((leg) => leg.expiry));
  return certificate.window ? (parseWindowId(certificate.window)?.window.expirySec ?? 0) : 0;
}

/**
 * Inside the wallet's queue (`resumeWallet`): resends whatever a closed tab left in flight, byte for byte (the mint
 * answers from its cache, so nothing new is linked). Redeems and exit checks are not done here, together, but by the
 * upkeep loop, each at its position's own random time (terminal `use-upkeep.ts`, privacy re-audit V3).
 */
export async function resumePositions(network: Network, trading: Trading): Promise<void> {
  for (const record of (await current(network)).positions) {
    if (!record.pending) continue;
    try {
      await settle(network, trading, record);
    } catch {
      // Unreachable: tried again next time.
    }
  }
}
