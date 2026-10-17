import type { TicketStatus } from "@kakure/query";
import type { PillTone } from "@/markets/market-view";

/** Ticket states in words (plan §13.2), plus the in-app send states before a bundle can count the ticket. */
export type ShownStatus = TicketStatus | "sending" | "failed";

export const STATUS_LABEL: Record<ShownStatus, string> = {
  sending: "Sending privately",
  failed: "Not sent",
  waiting: "Waiting for a batch",
  missed: "Not counted",
  counted: "Counted",
  won: "Won",
  lost: "Lost",
  refunded: "Refunded",
  paid: "Paid",
  unknown: "Unknown",
};

export const STATUS_TONE: Record<ShownStatus, PillTone> = {
  sending: "neutral",
  failed: "down",
  waiting: "quiet",
  missed: "warn",
  counted: "accent",
  won: "up",
  lost: "down",
  refunded: "warn",
  paid: "up",
  unknown: "quiet",
};
