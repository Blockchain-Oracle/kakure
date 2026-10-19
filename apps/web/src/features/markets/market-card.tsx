"use client";

import { type Market, type Network, quoteTicket, type Side } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import { cx, Mark } from "@kakure/ui-web";
import { Lock } from "lucide-react";
import Link from "next/link";
import { Sparkline } from "@/features/chart/sparkline";
import { formatUsd } from "@/features/market/live-price";
import { formatCountdown } from "@/lib/time";
import { assetFor } from "./assets";
import { isBettable, referencePrice, sidesOf, sideWord, statePill, WINDOW_LABEL } from "./market-view";

/**
 * A market card (Mitoshi's MarketCard, mitoshi-code-study §3.1; 21st.dev isaiahbjork/prediction-market-card #2537):
 * mark, cadence and a live countdown; the question in a few words; the live price with its change against the line
 * the market is judged on, and a 24-hour sparkline; a LIVE ODDS ramp from the last released batch (sealed until
 * each side has 3); Up and Down showing what a 0.1 ticket pays now. Short copy only: the rules are on the market
 * page. The whole card opens `/m#<network>/<id>` (the id stays in the fragment, PD14).
 */
const QUOTE_SIZE_ZAT = 10_000_000n;
const BPS = 10_000;
const PERCENT = 100;
const DECIMALS = 2;
const SIGN: Record<string, string> = { U: "▲", D: "▼", Y: "✓", N: "✕" };
const UPWARD = new Set(["U", "Y"]);

export function MarketCard({ market, network, now }: { market: Market; network: Network; now: number }) {
  const asset = assetFor(market);
  const open = isBettable(market, now);
  const pill = statePill(market, now);
  const cutoffIn = Date.parse(market.cutoffAt) - now;
  const reference = referencePrice(market);
  const [a, b] = sidesOf(market);
  const pool = (side: string) => BigInt(market.released?.sides[side as Side]?.zat ?? "0");
  const released = !market.sealed && market.released;
  const total = pool(a) + pool(b);
  const share = released && total > 0n ? Number((pool(a) * BigInt(PERCENT)) / total) : null;

  return (
    <Link
      href={`/m#${network}/${market.id}`}
      className="kk-press group flex flex-col gap-3 rounded-group border border-border bg-card p-4 text-card-foreground outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2.5">
        <Mark mark={asset.mark} label={asset.symbol} size="row" />
        <div className="min-w-0 flex-1">
          <div className="text-body-strong text-foreground">{asset.symbol}</div>
          <div className="truncate text-meta text-muted-foreground">
            {market.strike ? "Range" : WINDOW_LABEL[market.window]}
            {market.kind === "close" ? ` · ${asset.category === "stocks" ? "session" : "24/7"}` : ""}
          </div>
        </div>
        {open ? (
          <span className="flex items-center gap-1.5 font-mono text-num-sm text-foreground">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
            <span suppressHydrationWarning>{formatCountdown(cutoffIn)}</span>
          </span>
        ) : (
          <span className="text-meta text-muted-foreground">{pill.label}</span>
        )}
      </div>

      <h3 className="text-body-strong text-foreground">{question(market, asset.symbol, reference)}</h3>

      {asset.stream ? (
        <div className="flex items-end justify-between gap-3">
          <CardPrice stream={asset.stream} reference={reference} />
          <Sparkline symbol={asset.stream} className="h-9 w-28 shrink-0" />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-label-micro text-muted-foreground">
          <span>{released ? `LIVE ODDS · BATCH ${market.released?.seq}` : "ODDS SEALED"}</span>
          <span>
            {market.ticketCount} {market.ticketCount === 1 ? "ticket" : "tickets"}
          </span>
        </div>
        {share === null ? (
          <div className="flex h-1.5 items-center rounded-full bg-[repeating-linear-gradient(135deg,var(--border-strong)_0_4px,transparent_4px_8px)]">
            <Lock aria-hidden className="sr-only" />
          </div>
        ) : (
          <div className="flex h-1.5 overflow-hidden rounded-full bg-down">
            <div className="h-full bg-up" style={{ width: `${share}%` }} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[a, b].map((side) => {
          const quote = released ? quoteTicket(QUOTE_SIZE_ZAT, pool(side), pool(side === a ? b : a)) : null;
          const up = UPWARD.has(side);
          return (
            <span
              key={side}
              className={cx(
                "flex h-10 items-center justify-center gap-1.5 rounded-button text-button-compact",
                up
                  ? "bg-up-surface text-up shadow-[inset_0_0_0_1px_var(--up)]"
                  : "bg-down-surface text-down shadow-[inset_0_0_0_1px_var(--down)]",
                !open && "opacity-60",
              )}
            >
              <span aria-hidden>{SIGN[side]}</span> {sideWord(side).toUpperCase()}
              {quote ? (
                <span className="font-mono text-num-sm">{(Number(quote.multipleBps) / BPS).toFixed(DECIMALS)}×</span>
              ) : null}
            </span>
          );
        })}
      </div>
    </Link>
  );
}

function CardPrice({
  stream,
  reference,
}: {
  stream: NonNullable<ReturnType<typeof assetFor>["stream"]>;
  reference: number | null;
}) {
  const price = usePrice(stream);
  if (!price.price) return <span className="text-meta text-muted-foreground">Connecting…</span>;
  const value = Number(price.price);
  const change = reference ? ((value - reference) / reference) * PERCENT : null;
  return (
    <div className="min-w-0">
      <div className="font-mono text-num-md text-foreground">{formatUsd(price.price)}</div>
      {change === null ? null : (
        <div className={cx("font-mono text-num-sm", change >= 0 ? "text-up" : "text-down")}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(DECIMALS)}% vs {reference === null ? "open" : "line"}
        </div>
      )}
    </div>
  );
}

function question(market: Market, symbol: string, reference: number | null): string {
  if (market.kind === "event") return market.rules.question;
  if (market.strike) return `${symbol} above $${Number(market.strike).toLocaleString("en-US")} at the close?`;
  if (reference === null) return `${symbol} up or down by the close?`;
  return `${symbol} closes above ${formatUsd(String(reference))}?`;
}
