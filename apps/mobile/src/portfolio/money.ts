import type { Bundle } from "@kakure/domain";
import { type TicketView, viewTicket } from "@kakure/query";
import type { AppTicket } from "@/tickets/ticket-db";

/** Positions and P&L from this device's tickets and the signed bundle. Nothing is estimated that isn't labelled. */
export interface Position {
  ticket: AppTicket;
  view: TicketView;
  open: boolean;
}

const OPEN = new Set(["waiting", "counted"]);

export function positionsOf(tickets: readonly AppTicket[], bundle: Bundle | null, now: number): Position[] {
  return tickets.map((ticket) => {
    const view = viewTicket(ticket, bundle, now);
    const failed = ticket.send?.state === "failed";
    return { ticket, view, open: OPEN.has(view.status) && !failed };
  });
}

export interface Totals {
  /** Stake still riding (open tickets). */
  atRisk: bigint;
  /** Realised result of settled tickets: payouts minus stakes (refunds are zero). */
  pnl: bigint;
  /** Wins whose payout amount isn't known yet (no released totals): left out of P&L. */
  pending: number;
}

export function totalsOf(positions: readonly Position[]): Totals {
  let atRisk = 0n;
  let pnl = 0n;
  let pending = 0;
  for (const { ticket, view, open } of positions) {
    const size = BigInt(ticket.sizeZat);
    if (ticket.send?.state === "failed") continue;
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
