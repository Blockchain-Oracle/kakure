import type { TicketStatus } from "@kakure/query";
import type { PillTone } from "@kakure/ui-web";

/** Ticket states in words (plan §13.2). Each says what the site can know, never more. */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  waiting: "Waiting for the chain",
  missed: "Not counted",
  counted: "Counted",
  won: "Won",
  lost: "Lost",
  refunded: "Refunded",
  paid: "Paid out",
  unknown: "Not in the latest batch",
};

export const STATUS_DETAIL: Record<TicketStatus, string> = {
  waiting: "Pay from your wallet before betting closes. The next signed batch after it's mined lists it.",
  missed:
    "No signed batch listed this ticket by the cutoff. If you paid late or a different amount, the refund goes to your payout address under the rules; if you didn't pay, nothing was lost.",
  counted: "Its hash is in the signed ticket list, so it counts toward the pools.",
  won: "Your side won. The payout is due to your payout address in the payout window (2–6 h after resolution).",
  lost: "The other side won. Nothing more is due.",
  refunded: "This market refunded every ticket. The refund goes to your payout address in the payout window.",
  paid: "The operator marks this market's payouts as sent. Check your wallet to see it arrive.",
  unknown: "This market isn't in the current signed batch, and this device never saw its result.",
};

export const STATUS_TONE: Record<TicketStatus, PillTone> = {
  waiting: "neutral",
  missed: "warn",
  counted: "neutral",
  won: "up",
  lost: "down",
  refunded: "warn",
  paid: "up",
  unknown: "quiet",
};
