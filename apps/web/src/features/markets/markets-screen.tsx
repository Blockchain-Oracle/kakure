"use client";

import type { Bundle, Network } from "@kakure/domain";
import { nextBatchAt } from "@kakure/query";
import { Button, Chip, ChipGroup, EmptyState, SearchField, Tabs } from "@kakure/ui-web";
import { ChartLine, Hourglass, RefreshCw, SearchX, Timer } from "lucide-react";
import { useState } from "react";
import { NETWORK_LABEL } from "@/constants";
import { DataErrorState, FreshnessStrip } from "@/features/data/data-states";
import { useMarkets } from "@/features/data/use-markets";
import { switchNetwork } from "@/features/network/network-store";
import { formatClock, formatCountdown, useNow } from "@/lib/time";
import { assetFor } from "./assets";
import { type Category, setCategory, useCategory } from "./category-store";
import { filterMarkets, openCounts, type WindowFilter } from "./filters";
import { MarketCard } from "./market-card";
import { MarketsSkeleton } from "./markets-skeleton";

const TAB_LABEL: Record<Category, string> = { crypto: "Crypto", stocks: "Stocks", zcash: "Zcash" };
const WINDOWS: ReadonlyArray<{ value: WindowFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "1h", label: "Hourly" },
  { value: "1d", label: "Daily" },
];
const GRID_ID = "market-grid";

/** Markets (C1, surfaces.md): tabs, window chips, Closing soon, search, and cards from the signed bundle. */
export function MarketsScreen() {
  const data = useMarkets();
  const category = useCategory();
  const now = useNow();
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("all");
  const [closingSoon, setClosingSoon] = useState(false);
  const [query, setQuery] = useState("");
  const markets = data.status === "ready" ? data.bundle.markets : [];
  const counts = openCounts(markets, now);

  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5 px-5 py-6 rail:px-8 rail:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-page-title text-foreground">Markets</h1>
        {data.status === "ready" ? <BatchMeta bundle={data.bundle} now={now} /> : null}
      </div>

      <Tabs
        label="Market type"
        controls={GRID_ID}
        value={category}
        onChange={(next) => setCategory(next)}
        items={(Object.keys(TAB_LABEL) as Category[]).map((value) => ({
          value,
          label: TAB_LABEL[value],
          ...(data.status === "ready" ? { count: counts[value] } : {}),
        }))}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <ChipGroup label="Window">
            {WINDOWS.map((option) => (
              <Chip
                key={option.value}
                selected={windowFilter === option.value}
                onClick={() => setWindowFilter(option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </ChipGroup>
          <Chip kind="toggle" selected={closingSoon} onClick={() => setClosingSoon(!closingSoon)} icon={<Timer />}>
            Closing soon
          </Chip>
        </div>
        <SearchField
          label="Search markets"
          placeholder="Search BTC, Zcash…"
          value={query}
          onChange={setQuery}
          className="md:w-64"
        />
      </div>

      {data.status === "ready" ? (
        <FreshnessStrip
          publishedAt={data.latest.publishedAt}
          checkedAt={data.checkedAt}
          refreshError={data.refreshError}
          onRetry={data.refetch}
        />
      ) : null}

      <section id={GRID_ID} aria-live="polite">
        {data.status === "loading" ? <MarketsSkeleton /> : null}
        {data.status === "error" ? (
          <DataErrorState error={data.error} network={data.network} onRetry={data.refetch} />
        ) : null}
        {data.status === "unpublished" ? <Unpublished network={data.network} onRetry={data.refetch} /> : null}
        {data.status === "ready" ? (
          <MarketGrid
            bundle={data.bundle}
            network={data.network}
            now={now}
            category={category}
            filters={{ window: windowFilter, closingSoon, query }}
            onClear={() => {
              setWindowFilter("all");
              setClosingSoon(false);
              setQuery("");
            }}
          />
        ) : null}
      </section>
    </div>
  );
}

function BatchMeta({ bundle, now }: { bundle: Bundle; now: number }) {
  const next = nextBatchAt(bundle);
  return (
    <p className="text-money-meta text-muted-foreground">
      Batch {bundle.seq} · {formatClock(bundle.publishedAt)}
      {now > 0 && next > now ? (
        <>
          {" "}
          · next in <span className="tabular-nums">{formatCountdown(next - now)}</span>
        </>
      ) : null}
    </p>
  );
}

function Unpublished({ network, onRetry }: { network: Network; onRetry: () => void }) {
  return (
    <EmptyState
      icon={<Hourglass />}
      title="No markets published yet"
      reason={`The operator hasn't published a signed batch for ${NETWORK_LABEL[network]} yet. Batches go out every 10 minutes, and this page checks again on its own.`}
      action={
        <>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden className="size-4" /> Check now
          </Button>
          {network === "mainnet" ? (
            <Button variant="quiet" size="sm" onClick={() => switchNetwork("testnet")}>
              Switch to Testnet
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function MarketGrid({
  bundle,
  network,
  now,
  category,
  filters,
  onClear,
}: {
  bundle: Bundle;
  network: Network;
  now: number;
  category: Category;
  filters: { window: WindowFilter; closingSoon: boolean; query: string };
  onClear: () => void;
}) {
  const inTab = bundle.markets.filter((market) => assetFor(market).category === category);
  const shown = filterMarkets(bundle.markets, { category, ...filters }, now);
  const nextBatch = formatClock(nextBatchAt(bundle));

  if (inTab.length === 0) {
    if (category === "stocks") {
      return (
        <EmptyState
          icon={<ChartLine />}
          title="Stock markets open once the price feed is connected"
          reason="Stocks settle only when two keyed sources, Pyth and Alpaca, agree on the close. Until that feed is live, no stock market opens here. Crypto and Zcash markets are open now."
          action={
            <Button variant="secondary" size="sm" onClick={() => setCategory("crypto")}>
              See crypto markets
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<Hourglass />}
        title={`No ${TAB_LABEL[category]} markets in this batch`}
        reason={`Batch ${bundle.seq} has none. The next batch is at ${nextBatch}.`}
        action={
          <Button variant="secondary" size="sm" onClick={() => setCategory(category === "crypto" ? "zcash" : "crypto")}>
            See {category === "crypto" ? "Zcash" : "crypto"} markets
          </Button>
        }
      />
    );
  }

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={filters.closingSoon ? <Timer /> : <SearchX />}
        title={filters.closingSoon ? "Nothing closes in the next hour" : "No market matches"}
        reason={
          filters.query
            ? `No ${TAB_LABEL[category]} market matches "${filters.query}" with these filters.`
            : "These filters hide every market in this tab."
        }
        action={
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {shown.map((market) => (
        <li key={market.id}>
          <MarketCard market={market} network={network} now={now} />
        </li>
      ))}
    </ul>
  );
}
