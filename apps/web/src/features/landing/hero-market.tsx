"use client";

import { type Market, TICKET_SIZES_ZAT, zatToZec } from "@kakure/domain";
import { nextBatchAt } from "@kakure/query";
import { buttonClass, Mark, PartitionBar, Pill, Skeleton } from "@kakure/ui-web";
import { Lock } from "lucide-react";
import Link from "next/link";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { useMarkets } from "@/features/data/use-markets";
import { LivePrice } from "@/features/market/live-price";
import { assetFor } from "@/features/markets/assets";
import {
  isBettable,
  releasedOdds,
  sealedLine,
  shortTitle,
  statePill,
  WINDOW_LABEL,
} from "@/features/markets/market-view";
import { formatClock, formatCountdown, useNow } from "@/lib/time";

/**
 * The hero's live product view (refero-design-research §3.2): one real open market from the signed bundle, its
 * live spot from the relay, the cutoff, the sealed state or last released odds, and the fixed tickets. Nothing
 * here is drawn from a guess: no bundle, no card.
 */
export function featuredMarket(markets: readonly Market[], now: number): Market | null {
  const open = markets.filter((market) => isBettable(market, now));
  const byCutoff = (a: Market, b: Market) => Date.parse(a.cutoffAt) - Date.parse(b.cutoffAt);
  const withStream = open.filter((market) => assetFor(market).stream).sort(byCutoff);
  return withStream[0] ?? open.sort(byCutoff)[0] ?? markets.find((market) => market.state === "scheduled") ?? null;
}

export function HeroMarket() {
  const data = useMarkets();
  const now = useNow();
  if (data.status === "loading") return <Skeleton className="h-[26rem] w-full rounded-stage" />;
  if (data.status !== "ready") {
    return (
      <div className="flex h-full min-h-72 flex-col justify-center rounded-stage border border-border bg-card p-6 text-center">
        <p className="text-title text-foreground">
          {data.status === "unpublished" ? "No markets published yet" : "The signed batch didn't load"}
        </p>
        <p className="mt-2 text-row-detail text-muted-foreground">
          {data.status === "unpublished"
            ? `The operator hasn't published a batch for ${NETWORK_LABEL[data.network]} yet. Batches go out every 10 minutes.`
            : "This view only shows files signed by the operator. Try again in a moment."}
        </p>
      </div>
    );
  }
  const market = featuredMarket(data.bundle.markets, now);
  if (!market) {
    return (
      <div className="rounded-stage border border-border bg-card p-6 text-row-detail text-muted-foreground">
        Batch {data.bundle.seq} lists no open market right now. The next batch is at{" "}
        {formatClock(nextBatchAt(data.bundle))}.
      </div>
    );
  }
  const asset = assetFor(market);
  const pill = statePill(market, now);
  const odds = releasedOdds(market);
  const coin = NETWORK_COIN[data.network];
  const link = `/m#${data.network}/${market.id}`;
  return (
    <article
      className="flex flex-col gap-5 rounded-stage border border-border bg-card p-6 shadow-receipt"
      aria-label="A live market"
    >
      <div className="flex items-center gap-3">
        <Mark mark={asset.mark} label={asset.symbol} size="detail" />
        <div className="min-w-0 flex-1">
          <div className="text-row-title text-foreground">{shortTitle(market, asset.symbol)}</div>
          <div className="text-meta text-muted-foreground">
            {asset.name} · {WINDOW_LABEL[market.window]} · {NETWORK_LABEL[data.network]}
          </div>
        </div>
        <Pill tone={pill.tone} indicator={pill.pulse ? "pulse" : false}>
          {pill.label}
        </Pill>
      </div>
      {asset.stream ? <LivePrice stream={asset.stream} /> : null}
      <div className="flex items-baseline justify-between text-row-detail text-muted-foreground">
        <span>
          Betting closes in{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCountdown(Date.parse(market.cutoffAt) - now)}
          </span>
        </span>
        <span>
          Batch {data.bundle.seq} · signed {formatClock(data.bundle.publishedAt)}
        </span>
      </div>
      {odds ? (
        <PartitionBar
          label={`Odds released in batch ${odds.seq}`}
          segments={odds.sides.map((side) => ({
            key: side.side,
            value: Number(side.zat),
            tone: side.side === "U" || side.side === "Y" ? "up" : "down",
            title: `${side.sign} ${side.word} ${side.percent}%`,
          }))}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-row bg-secondary px-3 py-2.5 text-row-detail text-secondary-foreground">
          <Lock aria-hidden className="size-4 shrink-0" />
          {sealedLine(market)}
        </div>
      )}
      <ul className="flex flex-wrap gap-2" aria-label="Ticket sizes">
        {TICKET_SIZES_ZAT.map((size) => (
          <li
            key={size.toString()}
            className="rounded-full bg-secondary px-3 py-1.5 text-chip-label text-secondary-foreground"
          >
            {zatToZec(size)} {coin}
          </li>
        ))}
      </ul>
      <Link href={link} className={buttonClass("primary", "lg", "w-full")}>
        {market.kind === "event"
          ? "Bet on this event"
          : `Bet on ${asset.symbol} ${WINDOW_LABEL[market.window].toLowerCase()}`}
      </Link>
    </article>
  );
}
