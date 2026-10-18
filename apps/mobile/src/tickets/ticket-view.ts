import type { Bundle, Market } from "@kakure/domain";
import { type TicketView, viewTicket } from "@kakure/query";
import type { AppTicket } from "./ticket-db";

/**
 * A ticket's status as the app shows it: the shared view (@kakure/query) plus the release rule (audit O1, PD28).
 *
 * The operator publishes a market's count and leaves only once at least 3 new tickets are pending, so a paid ticket
 * can stay out of the signed list for a while, even past the cutoff: it is "waiting for its batch", not missed. At
 * the final freeze, fewer than 3 pending tickets are refunded in full and never published. The shared view calls
 * every unlisted ticket after the cutoff "missed"; this one keeps it waiting until the market is past its close, then
 * calls an in-time payment refunded. A payment mined at or after the cutoff block stays "missed" (late, refunded by
 * rule), and so does a QR ticket the app cannot see paid.
 */
export const WAITING_COPY =
  "Waiting for its batch: counted once 3 new tickets arrive; refunded in full if the market closes first.";

/** The same, as the detail under the progress steps' "Counted". */
export const WAITING_STEP = "Once 3 new tickets arrive; refunded in full if the market closes first";

export const NEVER_PUBLISHED_COPY =
  "Refunded in full: fewer than 3 new tickets arrived before the market closed, so this ticket was never published.";

/** Past the close: the final freeze has happened, so the signed list is complete. */
const PAST_CLOSE: ReadonlySet<Market["state"]> = new Set(["resolving", "resolved", "refunding", "paid"]);

function minedAt(ticket: AppTicket): number | undefined {
  return ticket.send?.state === "sent" ? ticket.send.minedHeight : undefined;
}

function minedLate(ticket: AppTicket, market: Market): boolean {
  const mined = minedAt(ticket);
  return mined !== undefined && market.cutoffHeight !== undefined && mined >= market.cutoffHeight;
}

function minedInTime(ticket: AppTicket, market: Market): boolean {
  const mined = minedAt(ticket);
  return mined !== undefined && market.cutoffHeight !== undefined && mined < market.cutoffHeight;
}

export interface AppTicketView extends TicketView {
  /** Refunded under PD28: paid in time, never published. */
  neverPublished: boolean;
}

export function viewAppTicket(ticket: AppTicket, bundle: Bundle | null, now: number): AppTicketView {
  const view = viewTicket(ticket, bundle, now);
  const market = view.market;
  if (view.status !== "missed" || !market || minedLate(ticket, market)) return { ...view, neverPublished: false };
  if (!PAST_CLOSE.has(market.state)) return { ...view, status: "waiting", neverPublished: false };
  if (minedInTime(ticket, market)) {
    return { ...view, status: "refunded", payoutZat: BigInt(ticket.sizeZat), neverPublished: true };
  }
  return { ...view, neverPublished: false };
}
