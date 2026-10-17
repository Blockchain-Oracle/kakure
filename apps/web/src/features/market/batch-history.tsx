"use client";

import type { Bundle, Market } from "@kakure/domain";
import { nextBatchAt } from "@kakure/query";
import { Timeline, type TimelineItem, type TimelineStatus } from "@kakure/ui-web";
import { sideWord, ticketsWord } from "@/features/markets/market-view";
import { formatWhen } from "@/lib/time";

const HEIGHT = new Intl.NumberFormat("en-US");

function at(time: string | number, now: number): TimelineStatus {
  return now >= (typeof time === "number" ? time : Date.parse(time)) ? "done" : "pending";
}

/**
 * This market's life as the current signed bundle records it: opened, the last odds release, this batch, the next
 * batch on the clock, the cutoff (with its block once final), the close, the outcome and the coarse payout run.
 * Payout txids are never published (PD7), so none appear here.
 */
export function BatchHistory({ market, bundle, now }: { market: Market; bundle: Bundle; now: number }) {
  const next = nextBatchAt(bundle);
  const cutoff = Date.parse(market.cutoffAt);
  const resolved = market.state === "resolved" || market.state === "refunding" || market.state === "paid";
  const items: TimelineItem[] = [
    { key: "opened", title: "Betting opened", time: formatWhen(market.opensAt, now), status: at(market.opensAt, now) },
  ];
  if (market.released) {
    items.push({
      key: "released",
      title: `Odds released in batch ${market.released.seq}`,
      detail: "Each side reached the minimum, so the totals became public.",
      status: "done",
    });
  }
  items.push({
    key: "batch",
    title: `Batch ${bundle.seq} published`,
    detail: market.sealed ? `${ticketsWord(market.ticketCount)} · odds sealed` : `${ticketsWord(market.ticketCount)}`,
    time: formatWhen(bundle.publishedAt, now),
    status: "done",
  });
  if (now < cutoff && !resolved) {
    items.push({
      key: "next",
      title: "Next batch",
      time: formatWhen(new Date(next).toISOString(), now),
      status: "active",
    });
  }
  items.push({
    key: "cutoff",
    title: "Betting closes",
    detail:
      market.cutoffHeight === undefined
        ? "Bets mined before the first block at or after this time count."
        : `Cutoff block ${HEIGHT.format(market.cutoffHeight)}`,
    time: formatWhen(market.cutoffAt, now),
    status: at(market.cutoffAt, now),
  });
  items.push({
    key: "close",
    title: "Market closes",
    time: formatWhen(market.closesAt, now),
    status: at(market.closesAt, now),
  });
  if (market.outcome) {
    items.push({
      key: "outcome",
      title:
        market.outcome === "refund" ? "Refunded: every ticket is returned" : `Resolved: ${sideWord(market.outcome)}`,
      ...(market.resolution ? { detail: `Evidence: ${market.resolution}` } : {}),
      status: "done",
    });
  }
  if (resolved) {
    for (const run of bundle.payoutRuns) {
      items.push({
        key: `run-${run.resolvedBefore}`,
        title: `Markets resolved before ${formatWhen(run.resolvedBefore, now)}: all sent by ${formatWhen(run.allSentBy, now)}`,
        status: at(run.allSentBy, now),
      });
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-group bg-card p-5" aria-labelledby="history-title">
      <h2 id="history-title" className="text-title text-foreground">
        Batch history
      </h2>
      <Timeline label="Batch history" items={items} />
    </section>
  );
}
