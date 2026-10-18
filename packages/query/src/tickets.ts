import {
  type Bundle,
  fromBase64Url,
  type Market,
  NETWORKS,
  type Network,
  payoutZat,
  type Side,
  TICKET_SIZES_ZAT,
  ticketHashHex,
  toBase64Url,
  utf8,
} from "@kakure/domain";

/**
 * A ticket as this device keeps it (never sent anywhere). The nonce and payout address are the bettor's secret:
 * the nonce proves the ticket, the address is where the payout goes. Market facts are copied in so the ticket
 * stays readable after its market leaves the bundle.
 */
export interface Ticket {
  /** The leaf: ticketHashHex(network, market, side, size, nonce). */
  hash: string;
  network: Network;
  marketId: string;
  side: Side;
  sizeZat: string;
  nonce: string;
  payoutAddress: string;
  /** The market address this ticket's QR paid (one of the signed list). */
  marketAddress: string;
  createdAt: number;
  question: string;
  subject: string;
  kind: Market["kind"];
  window: Market["window"];
  cutoffAt: string;
  closesAt: string;
  /** Last status seen in a bundle, kept when the market is no longer listed. */
  last?: { status: TicketStatus; seq: number; payoutZat?: string };
}

/**
 * Ticket states on the web (plan §13.2, adapted: the site can't see the bettor's wallet).
 * built → waiting → counted → won / lost / refunded, then paid once the market's payout run is marked sent.
 * - `waiting`: not in the signed list yet. Counts and ticket hashes are published only in groups of at least
 *   MIN_NEW_TICKETS_PER_RELEASE new tickets, so a paid ticket waits for its group; if fewer than that are pending
 *   when the cutoff block is final, they are refunded in full and never published (PD28).
 * - `missed`: the cutoff block is final and the ticket was never listed (unpaid, late, a wrong amount, or refunded
 *   under PD28).
 * - `unknown`: the market isn't in the current bundle and nothing was seen before.
 */
export type TicketStatus = "waiting" | "missed" | "counted" | "won" | "lost" | "refunded" | "paid" | "unknown";

export function ticketLeaf(ticket: Pick<Ticket, "network" | "marketId" | "side" | "sizeZat" | "nonce">): string {
  return ticketHashHex({
    network: ticket.network,
    marketId: ticket.marketId,
    side: ticket.side,
    sizeZat: BigInt(ticket.sizeZat),
    nonce: fromBase64Url(ticket.nonce),
  });
}

/** What a winning ticket of this size is paid at the given totals (null when either side is empty). */
export function winningPayout(market: Market, side: Side, sizeZat: bigint): bigint | null {
  const sides = market.released?.sides;
  if (!sides) return null;
  const otherSide = (Object.keys(sides) as Side[]).find((key) => key !== side);
  const winning = BigInt(sides[side]?.zat ?? "0");
  const losing = BigInt(otherSide ? (sides[otherSide]?.zat ?? "0") : "0");
  if (winning <= 0n || losing <= 0n || !TICKET_SIZES_ZAT.includes(sizeZat)) return null;
  return payoutZat(sizeZat, winning, losing);
}

export interface TicketView {
  status: TicketStatus;
  /** The bundle the status was read from. */
  seq: number | null;
  market: Market | null;
  /** For won tickets: the payout at the final released totals (the operator pays on the grid, plan §13.1). */
  payoutZat: bigint | null;
}

const FINAL_STATES: ReadonlySet<Market["state"]> = new Set(["resolving", "resolved", "refunding", "paid"]);

/** The cutoff block is final (H_c published): the ticket list won't grow any more. */
export function isFinal(market: Market): boolean {
  return market.cutoffHeight !== undefined || FINAL_STATES.has(market.state);
}

/** Derives a ticket's status from the current signed bundle (and what was seen before). */
export function viewTicket(ticket: Ticket, bundle: Bundle | null, now: number): TicketView {
  const market = bundle?.markets.find((candidate) => candidate.id === ticket.marketId) ?? null;
  if (!bundle || !market) {
    const last = ticket.last;
    if (last) {
      return {
        status: last.status,
        seq: last.seq,
        market: null,
        payoutZat: last.payoutZat ? BigInt(last.payoutZat) : null,
      };
    }
    return {
      status: now < Date.parse(ticket.closesAt) ? "waiting" : "unknown",
      seq: null,
      market: null,
      payoutZat: null,
    };
  }
  const counted = market.leaves.includes(ticket.hash);
  const seq = bundle.seq;
  if (!counted) {
    // Not listed: unpaid, or paid and waiting for its group, until the cutoff block is final (PD28).
    return { status: isFinal(market) ? "missed" : "waiting", seq, market, payoutZat: null };
  }
  if (market.outcome === "refund" || market.state === "refunding") {
    return { status: "refunded", seq, market, payoutZat: BigInt(ticket.sizeZat) };
  }
  if (market.outcome) {
    if (market.outcome !== ticket.side) return { status: "lost", seq, market, payoutZat: 0n };
    const payout = winningPayout(market, ticket.side, BigInt(ticket.sizeZat));
    return { status: market.state === "paid" ? "paid" : "won", seq, market, payoutZat: payout };
  }
  return { status: "counted", seq, market, payoutZat: null };
}

// ── Receipts (plan §3): built from the local ticket plus the signed bundle; redacted by default
// (no payout address, no txid, no bet time). "Provable" adds the nonce so anyone can recompute the leaf.

export interface Receipt {
  v: 1;
  network: Network;
  marketId: string;
  side: Side;
  sizeZat: string;
  /** Present only in Provable mode. */
  nonce?: string;
  /** The batch the receipt was made from. */
  seq?: number;
}

const RECEIPT_VERSION = 1;

export function encodeReceipt(ticket: Ticket, mode: "provable" | "outcome", seq?: number): string {
  const receipt: Receipt = {
    v: RECEIPT_VERSION,
    network: ticket.network,
    marketId: ticket.marketId,
    side: ticket.side,
    sizeZat: ticket.sizeZat,
    ...(mode === "provable" ? { nonce: ticket.nonce } : {}),
    ...(seq === undefined ? {} : { seq }),
  };
  return toBase64Url(utf8.encode(JSON.stringify(receipt)));
}

export function decodeReceipt(fragment: string): Receipt | null {
  try {
    const value = JSON.parse(utf8.decode(fromBase64Url(fragment.replace(/^#/, "")))) as Partial<Receipt>;
    if (value.v !== RECEIPT_VERSION || !value.network || !(NETWORKS as readonly string[]).includes(value.network)) {
      return null;
    }
    if (typeof value.marketId !== "string" || typeof value.side !== "string" || typeof value.sizeZat !== "string") {
      return null;
    }
    if (!TICKET_SIZES_ZAT.includes(BigInt(value.sizeZat))) return null;
    return value as Receipt;
  } catch {
    return null;
  }
}
