"use client";

import type { Market } from "@kakure/domain";
import type { ReactNode } from "react";
import { isBettable } from "@/features/markets/market-view";
import { formatCountdown, formatDateTime } from "@/lib/time";

const HEIGHT = new Intl.NumberFormat("en-US");

/** At most four facts at rest (kawase.md §4.8 page grammar): cutoff, close, the cutoff block, the opening reference. */
export function MarketFacts({ market, now }: { market: Market; now: number }) {
  const open = isBettable(market, now);
  const opening = market.opening ? Object.entries(market.opening) : [];
  return (
    <section className="rounded-group bg-card p-5" aria-label="Times">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Fact term="Betting closes">
          {formatDateTime(market.cutoffAt)}
          {open ? (
            <span className="block text-row-detail text-muted-foreground tabular-nums">
              in {formatCountdown(Date.parse(market.cutoffAt) - now)}
            </span>
          ) : null}
        </Fact>
        <Fact term="Market closes">{formatDateTime(market.closesAt)}</Fact>
        <Fact term="Cutoff block">
          {market.cutoffHeight === undefined ? (
            <span className="text-row-detail text-muted-foreground">Set once the cutoff block is final</span>
          ) : (
            <span className="tabular-nums">{HEIGHT.format(market.cutoffHeight)}</span>
          )}
        </Fact>
        <Fact term="Opens">{formatDateTime(market.opensAt)}</Fact>
      </dl>
      {opening.length > 0 ? (
        <div className="mt-4 rounded-row bg-raised-2 p-3">
          <div className="text-label text-muted-foreground">Opening reference, per venue</div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {opening.map(([venue, value]) => (
              <li key={venue} className="flex justify-between text-row-detail">
                <span className="text-muted-foreground capitalize">{venue}</span>
                <span className="text-foreground tabular-nums">{value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label text-muted-foreground">{term}</dt>
      <dd className="text-row-strong text-foreground">{children}</dd>
    </div>
  );
}
