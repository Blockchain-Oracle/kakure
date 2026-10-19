"use client";

import type { Market } from "@kakure/domain";
import { buttonClass, EmptyState, Mark, Skeleton } from "@kakure/ui-web";
import { Hourglass } from "lucide-react";
import Link from "next/link";
import { DataErrorState, FreshnessStrip } from "@/features/data/data-states";
import { useMarkets } from "@/features/data/use-markets";
import { parseMarketFragment, useFragment } from "@/features/market/fragment";
import { Terminal } from "@/features/market/terminal";
import { assetFor } from "@/features/markets/assets";
import { useNow } from "@/lib/time";

const DEFAULT_SYMBOL = "BTC";
const SYMBOL_PATTERN = /^[A-Z0-9]{1,10}$/;
/** The strip's order: the assets the hero, tape and bento lead with, then the rest alphabetically. */
const LEAD = ["BTC", "ETH", "SOL", "ZEC"];
const LIVE_STATES = new Set<Market["state"]>(["scheduled", "open", "closing"]);
/** Ranks: open before upcoming; within each, hourly, daily, then strike rungs. */
const LANE_COUNT = 3;

/**
 * The trade terminal (`/trade#BTC`, plan §0 R2): an asset strip over the live terminal. The fragment names either an
 * asset (`#ETH`: its soonest open hourly window, else daily, else the next to open) or one market (`#testnet/<id>`,
 * which the terminal's lanes link to). Like every market link, it lives in the fragment, which browsers never send.
 */
export function TradeScreen() {
  const fragment = useFragment();
  const data = useMarkets();
  const now = useNow();

  if (fragment === null || data.status === "loading") return <TradeSkeleton />;
  if (data.status === "error") {
    return <DataErrorState error={data.error} network={data.network} onRetry={data.refetch} />;
  }
  if (data.status === "unpublished") {
    return (
      <EmptyState
        icon={<Hourglass />}
        title="No markets published yet"
        reason="The operator hasn't published a signed batch on this network yet. Batches go out every 10 minutes."
      />
    );
  }

  const markets = data.bundle.markets.filter((m) => m.kind === "close" && LIVE_STATES.has(m.state));
  const named = parseMarketFragment(fragment);
  const market =
    (named && named.network === data.network ? markets.find((m) => m.id === named.id) : undefined) ??
    soonest(markets, symbolOf(fragment), now) ??
    soonest(markets, DEFAULT_SYMBOL, now);

  if (!market) {
    return (
      <EmptyState
        icon={<Hourglass />}
        title="No window is open right now"
        reason={`Batch ${data.bundle.seq} lists no live price market. Every open market is on the Markets page.`}
        action={
          <Link href="/markets" className={buttonClass("secondary", "sm")}>
            Browse markets
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <AssetStrip markets={markets} current={market.subject} />
      <Terminal
        market={market}
        bundle={data.bundle}
        addresses={data.addresses}
        network={data.network}
        now={now}
        freshness={
          <FreshnessStrip
            publishedAt={data.latest.publishedAt}
            checkedAt={data.checkedAt}
            refreshError={data.refreshError}
            onRetry={data.refetch}
          />
        }
      />
    </div>
  );
}

function symbolOf(fragment: string): string {
  const symbol = fragment.replace(/^#/, "").toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : DEFAULT_SYMBOL;
}

/** An asset's best window: open hourly, open daily, any open, then the next to open; strike rungs come last. */
function soonest(markets: readonly Market[], symbol: string, now: number): Market | undefined {
  const own = markets
    .filter((m) => m.subject.toUpperCase() === symbol)
    .sort((a, b) => rank(a, now) - rank(b, now) || Date.parse(a.cutoffAt) - Date.parse(b.cutoffAt));
  return own[0];
}

function rank(m: Market, now: number): number {
  const open = m.state !== "scheduled" && now < Date.parse(m.cutoffAt);
  const lane = m.strike ? 2 : m.window === "1h" ? 0 : 1;
  return (open ? 0 : LANE_COUNT) + lane;
}

/** One chip per asset with a live window; the current one is pressed. */
function AssetStrip({ markets, current }: { markets: readonly Market[]; current: string }) {
  const subjects = [...new Set(markets.map((m) => m.subject.toUpperCase()))].sort(
    (a, b) => leadRank(a) - leadRank(b) || a.localeCompare(b),
  );
  if (subjects.length <= 1) return null;
  return (
    <nav aria-label="Assets" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {subjects.map((symbol) => {
        const asset = assetFor({ kind: "close", subject: symbol });
        const pressed = symbol === current.toUpperCase();
        return (
          <a
            key={symbol}
            href={`#${symbol}`}
            aria-current={pressed ? "page" : undefined}
            className={`kk-press flex h-10 shrink-0 items-center gap-2 rounded-pill py-1 pr-4 pl-1.5 text-chip-label outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              pressed ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <Mark mark={asset.mark} label={asset.symbol} size="token" />
            {asset.symbol}
          </a>
        );
      })}
    </nav>
  );
}

function leadRank(symbol: string): number {
  const index = LEAD.indexOf(symbol);
  return index === -1 ? LEAD.length : index;
}

function TradeSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the terminal" className="flex flex-col gap-4">
      <div className="flex gap-1.5">
        {LEAD.map((symbol) => (
          <Skeleton key={symbol} className="h-10 w-24 rounded-pill" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 wide:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[520px] rounded-group" />
        <Skeleton className="h-[420px] rounded-group" />
      </div>
    </div>
  );
}
