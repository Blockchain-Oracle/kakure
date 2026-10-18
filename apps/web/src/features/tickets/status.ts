import { MIN_NEW_TICKETS_PER_RELEASE } from "@kakure/domain";
import type { TicketStatus } from "@kakure/query";
import type { PillTone } from "@kakure/ui-web";

/**
 * Ticket states in words (plan §13.2). Each says what the site can know, never more. The signed list grows only in
 * groups of at least MIN_NEW_TICKETS_PER_RELEASE new tickets, and a group still short of that when the cutoff block is
 * final is refunded and never published (PD28), so a paid ticket can wait several batches before it's listed.
 */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  waiting: "Waiting for its batch",
  missed: "Not counted",
  counted: "Counted",
  won: "Won",
  lost: "Lost",
  refunded: "Refunded",
  paid: "Paid out",
  unknown: "Not in the latest batch",
};

export const STATUS_DETAIL: Record<TicketStatus, string> = {
  waiting: `Counted once ${MIN_NEW_TICKETS_PER_RELEASE} new tickets arrive; refunded in full if the market closes first. If you haven't paid yet, pay from your wallet before betting closes.`,
  missed: `Never listed. If you paid, it's refunded to your payout address: late payments, wrong amounts of 0.001 ZEC or more, and a last group of fewer than ${MIN_NEW_TICKETS_PER_RELEASE} tickets are all refunded under the rules. If you didn't pay, nothing was lost.`,
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
