"use client";

import { quoteTicket, type Side } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { DecryptText, Mark, RollingNumber, Skeleton } from "@kakure/ui-web";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LiveWindowChart } from "@/features/chart/live-window-chart";
import { useMarkets } from "@/features/data/use-markets";
import { formatUsd } from "@/features/market/live-price";
import { assetFor } from "@/features/markets/assets";
import { featuredWindow, referencePrice, sidesOf } from "@/features/markets/market-view";
import { formatCountdown, useNow } from "@/lib/time";
import { WORDS } from "./words";

/**
 * The live window at the rim of the hole: BTC's open hourly market from the signed batch, its price rolling in from
 * the relay, the Window chart, and what each side pays for a 0.1 ticket as the pools stand (`quoteTicket`, the payout
 * formula with your stake added, as the terminal's ticket). A sealed pool's figures scramble until a signed batch
 * releases them. Every side links into the terminal on this market.
 */
const QUOTE_SIZE_ZAT = 10_000_000n;
const BPS = 10_000;
const MULTIPLE_DECIMALS = 2;
const PERCENT = 100;
const CHANGE_DECIMALS = 2;
const SIGN: Record<string, string> = { U: "▲", D: "▼", Y: "✓", N: "✕" };
const UPWARD = new Set(["U", "Y"]);

export function HeroWindow() {
  const data = useMarkets();
  const now = useNow();
  const w = WORDS.window;
  if (data.status === "loading") return <Skeleton className="lp-window h-[22rem] rounded-lg" />;
  const market = data.status === "ready" ? featuredWindow(data.bundle.markets, now) : undefined;
  if (!market) {
    return (
      <div className="lp-window">
        <p className="text-row-detail text-muted-foreground">{w.none}</p>
        <Link href="/markets" className="lp-btn lp-btn--glass lp-btn--sm">
          Markets <ArrowRight aria-hidden />
        </Link>
      </div>
    );
  }
  const asset = assetFor(market);
  const href = `/trade#${data.status === "ready" ? data.network : "testnet"}/${market.id}`;
  const reference = referencePrice(market);
  const cutoff = Date.parse(market.cutoffAt);
  const pool = (side: string) => BigInt(market.released?.sides[side as Side]?.zat ?? "0");
  const sealed = market.sealed || !market.released;
  const [a, b] = sidesOf(market);

  return (
    <article className="lp-window" aria-label={w.label(asset.symbol)}>
      <header className="flex items-center gap-3">
        <Mark mark={asset.mark} label={asset.symbol} size="token" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-display text-[15px] font-bold">
            {asset.symbol} <span className="text-meta font-normal text-muted-foreground">· {w.lane}</span>
          </div>
          <div className="font-mono text-[12px] text-muted-foreground tabular-nums">
            {now ? w.closesIn(formatCountdown(Math.max(0, cutoff - now))) : " "}
          </div>
        </div>
        {asset.stream ? <Price stream={asset.stream} reference={reference} /> : null}
      </header>
      {reference !== null ? (
        <p className="text-row-detail text-muted-foreground">
          {w.question(asset.symbol, formatUsd(String(reference)))}
        </p>
      ) : null}
      {asset.stream ? (
        <LiveWindowChart
          symbol={asset.stream}
          label={`${asset.symbol} price since the window opened`}
          className="lp-window-chart"
          spec={{
            opensAt: Date.parse(market.opensAt),
            closesAt: Date.parse(market.closesAt),
            reference,
            referenceLabel: reference === null ? "Open" : `Open ${formatUsd(String(reference))}`,
          }}
        />
      ) : null}
      <div className="lp-sides">
        {[a, b].map((side) => {
          const quote = sealed ? null : quoteTicket(QUOTE_SIZE_ZAT, pool(side), pool(side === a ? b : a));
          const multiple = quote ? `${(Number(quote.multipleBps) / BPS).toFixed(MULTIPLE_DECIMALS)}×` : null;
          const up = UPWARD.has(side);
          return (
            <Link key={side} href={href} className={`lp-side ${up ? "lp-side--up" : "lp-side--down"}`}>
              <span>
                {SIGN[side]} {up ? w.up : w.down}
              </span>
              <small>
                {multiple ? "pays " : ""}
                <DecryptText text={multiple} sealed={w.sealed} length={5} />
              </small>
            </Link>
          );
        })}
      </div>
      <footer className="flex items-center justify-between gap-3 text-meta text-muted-foreground">
        <span>{sealed ? w.sealedLine : `as the pools stand · batch ${market.released?.seq}`}</span>
        <Link href={href} className="flex shrink-0 items-center gap-1 font-semibold text-foreground hover:underline">
          {w.open} <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </footer>
    </article>
  );
}

function Price({ stream, reference }: { stream: StreamSymbol; reference: number | null }) {
  const price = usePrice(stream);
  if (!price.price) return <span className="text-meta text-muted-foreground">{WORDS.window.connecting}</span>;
  const value = Number(price.price);
  const change = reference ? ((value - reference) / reference) * PERCENT : null;
  return (
    <div className="flex flex-col items-end">
      <RollingNumber value={formatUsd(price.price)} className="font-mono text-[17px] font-semibold" />
      {change === null ? null : (
        <span className={`font-mono text-[12px] ${change >= 0 ? "text-up" : "text-down"}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(CHANGE_DECIMALS)}%
        </span>
      )}
    </div>
  );
}
