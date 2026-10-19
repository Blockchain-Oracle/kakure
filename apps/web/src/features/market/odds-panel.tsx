"use client";

import {
  type Bundle,
  type Market,
  MIN_NEW_TICKETS_PER_RELEASE,
  MIN_TICKETS_PER_SIDE,
  type Network,
} from "@kakure/domain";
import { nextBatchAt } from "@kakure/query";
import { PartitionBar } from "@kakure/ui-web";
import { Lock } from "lucide-react";
import { NETWORK_COIN } from "@/constants";
import { coinAmount, releasedOdds, ticketsWord } from "@/features/markets/market-view";
import { formatClock, formatCountdown } from "@/lib/time";

/**
 * The odds as of the last release, or the sealed panel (C5, D3): odds stay hidden until each side has
 * MIN_TICKETS_PER_SIDE tickets. The ticket count, the ticket list and the totals are all published only in groups of
 * at least MIN_NEW_TICKETS_PER_RELEASE new tickets (O1), and a last group short of that is refunded, never published
 * (PD28). The next batch time comes from the publish clock.
 */
export function OddsPanel({
  market,
  bundle,
  network,
  now,
}: {
  market: Market;
  bundle: Bundle;
  network: Network;
  now: number;
}) {
  const odds = releasedOdds(market);
  const next = nextBatchAt(bundle);
  const nextLine =
    now > 0 && next > now ? (
      <>
        Next batch in <span className="font-semibold text-foreground tabular-nums">{formatCountdown(next - now)}</span>{" "}
        (at {formatClock(next)})
      </>
    ) : (
      <>Next batch due at {formatClock(next)}</>
    );

  if (odds) {
    return (
      <section
        className="flex flex-col gap-4 rounded-group border border-border bg-card p-5"
        aria-labelledby="odds-title"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="odds-title" className="font-display text-title text-foreground">
            Odds
          </h2>
          <span className="text-money-meta text-muted-foreground">
            Released in batch {odds.seq} · {ticketsWord(market.ticketCount)}
          </span>
        </div>
        <PartitionBar
          label={`Odds released in batch ${odds.seq}`}
          segments={odds.sides.map((side) => ({
            key: side.side,
            value: Number(side.zat),
            tone: side.side === "U" || side.side === "Y" ? "up" : "down",
            title: `${side.sign} ${side.word} ${side.percent}%`,
            detail: (
              <>
                <span className="block">
                  {ticketsWord(side.tickets)} · {coinAmount(side.zat, NETWORK_COIN[network])}
                </span>
                {side.multiple ? (
                  <span className="block">
                    1 {NETWORK_COIN[network]} pays {side.multiple}
                  </span>
                ) : null}
              </>
            ),
          }))}
        />
        <p className="text-row-detail text-muted-foreground">
          The count and these totals change only in groups of at least {MIN_NEW_TICKETS_PER_RELEASE} new tickets, so no
          single bet shows. {nextLine}.
        </p>
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-group border border-border bg-card p-5"
      aria-labelledby="sealed-title"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 place-items-center rounded-md bg-secondary text-foreground">
          <Lock className="size-5" />
        </span>
        <div>
          <h2 id="sealed-title" className="font-display text-title text-foreground">
            Sealed
          </h2>
          <p className="text-row-detail text-muted-foreground">{ticketsWord(market.ticketCount)} listed</p>
        </div>
      </div>
      <p className="text-body text-foreground">
        Odds open when each side has {MIN_TICKETS_PER_SIDE} tickets. Until then only the count is published, and it
        moves in groups of at least {MIN_NEW_TICKETS_PER_RELEASE} new tickets, so no single bet shows.
      </p>
      <p className="text-row-detail text-muted-foreground">{nextLine}.</p>
    </section>
  );
}
