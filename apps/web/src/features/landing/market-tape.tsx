"use client";

import type { Market, Network } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import { nextBatchAt } from "@kakure/query";
import { Mark } from "@kakure/ui-web";
import Link from "next/link";
import { useMarkets } from "@/features/data/use-markets";
import { formatUsd } from "@/features/market/live-price";
import { assetFor } from "@/features/markets/assets";
import { isBettable, releasedOdds, ticketsWord, WINDOW_LABEL } from "@/features/markets/market-view";
import { formatClock, formatCountdown, formatShortWhen, useNow } from "@/lib/time";

/**
 * The live tape (refero-design-research §3.3; 21st.dev lukacho/marquee + haydenbleasel/ticker): every market in the
 * signed batch with its live spot from the relay, its cutoff, and sealed or released odds. Two copies slide in CSS
 * and pause on hover or focus; under reduced motion it is a plain scrollable row. If the batch can't load, the tape
 * isn't shown at all (Kawase's tape rule).
 */
const SECONDS_PER_ITEM = 5;
const MIN_LOOP_S = 40;

function Spot({ stream }: { stream: NonNullable<ReturnType<typeof assetFor>["stream"]> }) {
  const price = usePrice(stream);
  if (!price.price) return <span className="text-muted-foreground">connecting</span>;
  const text = formatUsd(price.price);
  return <span className={price.status === "live" ? "text-foreground" : "text-muted-foreground"}>{text}</span>;
}

function Item({ market, network, now }: { market: Market; network: Network; now: number }) {
  const asset = assetFor(market);
  const odds = releasedOdds(market);
  const open = isBettable(market, now);
  return (
    <Link
      href={`/m#${network}/${market.id}`}
      className="flex shrink-0 items-center gap-3 rounded-row bg-card px-4 py-3 outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Mark src={asset.mark} label={asset.symbol} size="token" />
      <span className="flex flex-col">
        <span className="text-row-strong text-foreground">
          {asset.symbol} <span className="text-meta text-muted-foreground">{WINDOW_LABEL[market.window]}</span>
        </span>
        <span className="text-money-meta tabular-nums">
          {asset.stream ? <Spot stream={asset.stream} /> : <span className="text-muted-foreground">chain event</span>}
        </span>
      </span>
      <span className="flex flex-col items-end text-money-meta text-muted-foreground tabular-nums">
        <span>
          {open
            ? `closes ${formatCountdown(Date.parse(market.cutoffAt) - now)}`
            : market.state === "scheduled"
              ? `opens ${formatShortWhen(market.opensAt, now)}`
              : "betting closed"}
        </span>
        <span>
          {odds
            ? odds.sides.map((side) => `${side.sign} ${side.percent}%`).join(" · ")
            : `sealed · ${ticketsWord(market.ticketCount)}`}
        </span>
      </span>
    </Link>
  );
}

export function MarketTape() {
  const data = useMarkets();
  const now = useNow();
  if (data.status !== "ready" || data.bundle.markets.length === 0) return null;
  const markets = data.bundle.markets;
  const duration = `${Math.max(MIN_LOOP_S, markets.length * SECONDS_PER_ITEM)}s`;
  return (
    <section aria-labelledby="tape-title" className="flex flex-col gap-3">
      <div className="mx-auto flex w-full max-w-(--layout-content-max) items-baseline justify-between gap-3 px-5 rail:px-8">
        <h2 id="tape-title" className="text-title text-foreground">
          Markets in the latest signed batch
        </h2>
        <span className="text-money-meta text-muted-foreground">
          Batch {data.bundle.seq} · {formatClock(data.bundle.publishedAt)} · next{" "}
          {formatClock(nextBatchAt(data.bundle))}
        </span>
      </div>
      <div className="kk-tape group overflow-hidden motion-reduce:overflow-x-auto">
        <div className="kk-tape-track flex w-max pl-5" style={{ animationDuration: duration }}>
          {[0, 1].map((copy) => (
            <div key={copy} className="flex gap-3 pr-3" aria-hidden={copy === 1} inert={copy === 1}>
              {markets.map((market) => (
                <Item key={`${copy}-${market.id}`} market={market} network={data.network} now={now} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
