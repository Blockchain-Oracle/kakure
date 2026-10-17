"use client";

import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { Pill, Skeleton } from "@kakure/ui-web";
import { formatAge, formatClock, useNow } from "@/lib/time";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 8 });
const USD_DIGITS_LARGE = 2;
const USD_DIGITS_SMALL = 6;
const SMALL_PRICE = 1;

function formatUsd(price: string): string {
  const value = Number(price);
  const digits = value >= SMALL_PRICE ? USD_DIGITS_LARGE : USD_DIGITS_SMALL;
  return USD.format(Number(value.toFixed(digits)));
}

/**
 * The live spot price from the Kakure price relay (`@kakure/feeds`; every client receives every symbol, PD19).
 * Honest states (R7): connecting shows the figure's shape, stale shows its age, closed says so. Never a made-up price.
 */
export function LivePrice({ stream }: { stream: StreamSymbol }) {
  const price = usePrice(stream);
  const now = useNow();
  const source = "Coinbase via the Kakure relay";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-label text-muted-foreground">{stream.replace("-", " / ")} spot</span>
        {price.status === "live" ? (
          <Pill tone="neutral" indicator="pulse">
            Live
          </Pill>
        ) : null}
        {price.status === "stale" && price.ts ? (
          <Pill tone="warn">Stale · {formatAge(Math.max(0, now - price.ts))} old</Pill>
        ) : null}
        {price.status === "closed" ? <Pill tone="quiet">Feed closed</Pill> : null}
      </div>
      {price.price ? (
        <span className="font-display text-display-price text-foreground tabular-nums">{formatUsd(price.price)}</span>
      ) : (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-11 w-56 rounded-md" />
          <span className="text-row-detail text-muted-foreground">Connecting to the price relay…</span>
        </div>
      )}
      <span className="text-meta text-muted-foreground">
        {price.ts ? `${source} · ${formatClock(price.ts)}` : source}
      </span>
    </div>
  );
}
