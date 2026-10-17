import type { Bundle } from "@kakure/domain";
import { type Ticket, type TicketView, viewTicket } from "@kakure/query";

/** Positions and P&L from this device's tickets and the signed bundle. Nothing is estimated that isn't labelled. */
export interface Position {
  ticket: Ticket;
  view: TicketView;
  open: boolean;
}

const OPEN = new Set(["waiting", "counted"]);

export function positionsOf(tickets: readonly Ticket[], bundle: Bundle | null, now: number): Position[] {
  return tickets.map((ticket) => {
    const view = viewTicket(ticket, bundle, now);
    return { ticket, view, open: OPEN.has(view.status) };
  });
}

export interface Totals {
  /** Stake still riding (open tickets). */
  atRisk: bigint;
  /** Realised result of settled tickets: payouts minus stakes (refunds are zero). */
  pnl: bigint;
  /** Tickets whose win is known but whose payout amount isn't (no released totals): left out of P&L. */
  pending: number;
}

export function totalsOf(positions: readonly Position[]): Totals {
  let atRisk = 0n;
  let pnl = 0n;
  let pending = 0;
  for (const { ticket, view, open } of positions) {
    const size = BigInt(ticket.sizeZat);
    if (open) {
      atRisk += size;
      continue;
    }
    if (view.status === "lost") pnl -= size;
    if (view.status === "won" || view.status === "paid") {
      if (view.payoutZat === null) pending += 1;
      else pnl += view.payoutZat - size;
    }
  }
  return { atRisk, pnl, pending };
}
