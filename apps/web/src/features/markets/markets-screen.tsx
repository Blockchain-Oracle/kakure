"use client";

import type { Bundle, Network } from "@kakure/domain";
import { nextBatchAt } from "@kakure/query";
import { Button, Chip, EmptyState, SearchField, Tabs } from "@kakure/ui-web";
import { ChartLine, Hourglass, RefreshCw, SearchX, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { NETWORK_LABEL } from "@/constants";
import { DataErrorState, FreshnessStrip } from "@/features/data/data-states";
import { useMarkets } from "@/features/data/use-markets";
import { Terminal } from "@/features/market/terminal";
import { switchNetwork } from "@/features/network/network-store";
import { formatClock, formatCountdown, useNow } from "@/lib/time";
import { isLane, LANE_LABEL, LANES, type Lane, laneMarkets } from "./filters";
import { MarketCard } from "./market-card";
import { featuredWindow, isBettable } from "./market-view";
import { MarketsSkeleton } from "./markets-skeleton";

const GRID_ID = "market-grid";
const DEFAULT_LANE: Lane = "hourly";

/** The lane lives in the fragment (`/markets#daily`), which browsers never send to the host. */
function useLane(): [Lane, (next: Lane) => void] {
  const [lane, setLane] = useState<Lane>(DEFAULT_LANE);
  useEffect(() => {
    const read = () => {
      const hash = location.hash.slice(1);
      setLane(isLane(hash) ? hash : DEFAULT_LANE);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return [
    lane,
    (next) => {
      history.replaceState(null, "", `#${next}`);
      setLane(next);
    },
  ];
}

/**
 * Markets (Mitoshi's markets page, mitoshi-code-study §3.1; plan §0 R2): a live terminal hero to bet from right here,
 * then the lanes (Hourly · Daily · Range · Stocks · Zcash · Resolved, by cadence, never by date), search, Closing
 * soon, and short cards with live prices, sparklines and what each side pays.
 */
export function MarketsScreen() {
  const data = useMarkets();
  const now = useNow();
  const [lane, setLane] = useLane();
  const [closingSoon, setClosingSoon] = useState(false);
  const [query, setQuery] = useState("");
  const markets = data.status === "ready" ? data.bundle.markets : [];
  const hero = data.status === "ready" ? featuredWindow(markets, now) : undefined;

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-page-title text-foreground">Markets</h1>
        {data.status === "ready" ? <BatchMeta bundle={data.bundle} now={now} /> : null}
      </div>

      {data.status === "ready" && hero ? (
        <Terminal
          hero
          market={hero}
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
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs
          label="Lane"
          controls={GRID_ID}
          value={lane}
          onChange={(next) => setLane(next)}
          items={LANES.map((value) => ({
            value,
            label: LANE_LABEL[value],
            ...(data.status === "ready" && value !== "resolved"
              ? { count: laneMarkets(markets, value, "", false, now).filter((m) => isBettable(m, now)).length }
              : {}),
          }))}
        />
        <div className="flex items-center gap-2">
          <Chip kind="toggle" selected={closingSoon} onClick={() => setClosingSoon(!closingSoon)} icon={<Timer />}>
            Closing soon
          </Chip>
          <SearchField
            label="Search markets"
            placeholder="Search BTC, Zcash…"
            value={query}
            onChange={setQuery}
            className="md:w-56"
          />
        </div>
      </div>

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
            lane={lane}
            query={query}
            closingSoon={closingSoon}
            onClear={() => {
              setClosingSoon(false);
              setQuery("");
            }}
            onLane={setLane}
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
  lane,
  query,
  closingSoon,
  onClear,
  onLane,
}: {
  bundle: Bundle;
  network: Network;
  now: number;
  lane: Lane;
  query: string;
  closingSoon: boolean;
  onClear: () => void;
  onLane: (lane: Lane) => void;
}) {
  const inLane = laneMarkets(bundle.markets, lane, "", false, now);
  const shown = laneMarkets(bundle.markets, lane, query, closingSoon, now);
  const nextBatch = formatClock(nextBatchAt(bundle));

  if (inLane.length === 0) {
    if (lane === "stocks") {
      return (
        <EmptyState
          icon={<ChartLine />}
          title="Stock markets open once the price feed is connected"
          reason="Stocks settle only when two keyed sources, Pyth and Alpaca, agree on the close."
          action={
            <Button variant="secondary" size="sm" onClick={() => onLane("hourly")}>
              See hourly markets
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<Hourglass />}
        title={`No ${LANE_LABEL[lane].toLowerCase()} markets right now`}
        reason={
          lane === "range"
            ? "Tomorrow's strike ladder is created two hours before the day opens."
            : `The next batch is at ${nextBatch}.`
        }
        action={
          <Button variant="secondary" size="sm" onClick={() => onLane(lane === "hourly" ? "daily" : "hourly")}>
            See {lane === "hourly" ? "daily" : "hourly"} markets
          </Button>
        }
      />
    );
  }

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={closingSoon ? <Timer /> : <SearchX />}
        title={closingSoon ? "Nothing closes in the next hour" : "No market matches"}
        reason={query ? `Nothing in ${LANE_LABEL[lane]} matches "${query}".` : "These filters hide every market here."}
        action={
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 wide:grid-cols-3">
      {shown.map((market) => (
        <li key={market.id}>
          <MarketCard market={market} network={network} now={now} />
        </li>
      ))}
    </ul>
  );
}
