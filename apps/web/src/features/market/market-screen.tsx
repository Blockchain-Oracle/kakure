"use client";

import type { Bundle, Market, Network } from "@kakure/domain";
import { Button, buttonClass, EmptyState, Mark, Pill, Skeleton, SkeletonLine } from "@kakure/ui-web";
import { ArrowLeft, Blocks, Hourglass, Link2Off, RefreshCw, Unplug } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { NETWORK_LABEL } from "@/constants";
import { DataErrorState, FreshnessStrip } from "@/features/data/data-states";
import { useMarkets } from "@/features/data/use-markets";
import { assetFor } from "@/features/markets/assets";
import { setCategory } from "@/features/markets/category-store";
import { statePill, WINDOW_LABEL } from "@/features/markets/market-view";
import { MainnetSheet } from "@/features/network/mainnet-sheet";
import { switchNetwork } from "@/features/network/network-store";
import { useNow } from "@/lib/time";
import { BatchHistory } from "./batch-history";
import { parseMarketFragment, useFragment } from "./fragment";
import { LivePrice } from "./live-price";
import { MarketFacts } from "./market-facts";
import { OddsPanel } from "./odds-panel";
import { RulesPanel } from "./rules-panel";

/** Market detail (`/m#<network>/<id>`, surfaces.md): header, live price, odds or sealed, times, rules, history. */
export function MarketScreen() {
  const fragment = useFragment();
  const data = useMarkets();
  const now = useNow();
  const target = fragment === null ? null : parseMarketFragment(fragment);
  const market = data.status === "ready" && target ? data.bundle.markets.find((m) => m.id === target.id) : undefined;

  useEffect(() => {
    if (market) setCategory(assetFor(market).category, { writeHash: false });
  }, [market]);

  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5 px-5 py-6 rail:px-8 rail:py-8">
      <Link
        href="/markets"
        className="flex w-fit items-center gap-1.5 rounded-xs text-row-detail text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-4" /> Markets
      </Link>
      {fragment === null || (target && target.network === data.network && data.status === "loading") ? (
        <DetailSkeleton />
      ) : !target ? (
        <EmptyState
          icon={<Link2Off />}
          title="This link doesn't name a market"
          reason="Market links look like /m#testnet/btc-1h-… . Pick a market from the list instead."
          action={<BrowseLink />}
        />
      ) : target.network !== data.network ? (
        <WrongNetwork wanted={target.network} />
      ) : data.status === "error" ? (
        <DataErrorState error={data.error} network={data.network} onRetry={data.refetch} />
      ) : data.status === "unpublished" ? (
        <EmptyState
          icon={<Hourglass />}
          title="No markets published yet"
          reason={`Nothing is published on ${NETWORK_LABEL[data.network]} yet, so this market can't be shown. Batches go out every 10 minutes.`}
          action={
            <Button variant="secondary" size="sm" onClick={data.refetch}>
              <RefreshCw aria-hidden className="size-4" /> Check now
            </Button>
          }
        />
      ) : data.status === "ready" && !market ? (
        <EmptyState
          icon={<Unplug />}
          title="This market isn't in the latest batch"
          reason={`Batch ${data.bundle.seq} doesn't list ${target.id}. It may not have opened yet, or it finished and was archived.`}
          action={<BrowseLink />}
        />
      ) : data.status === "ready" && market ? (
        <Detail
          market={market}
          bundle={data.bundle}
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
    </div>
  );
}

function Detail({
  market,
  bundle,
  network,
  now,
  freshness,
}: {
  market: Market;
  bundle: Bundle;
  network: Network;
  now: number;
  freshness: ReactNode;
}) {
  const asset = assetFor(market);
  const pill = statePill(market, now);
  return (
    <>
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Mark src={asset.mark} label={asset.symbol} size="detail" />
          <div className="min-w-0 flex-1">
            <div className="text-row-title text-foreground">{asset.name}</div>
            <div className="text-meta text-muted-foreground">
              {asset.symbol} · {WINDOW_LABEL[market.window]} · {NETWORK_LABEL[network]}
            </div>
          </div>
          <Pill tone={pill.tone} indicator={pill.pulse ? "pulse" : false}>
            {pill.label}
          </Pill>
        </div>
        <h1 className="font-display text-page-title text-foreground">{market.rules.question}</h1>
      </header>
      {freshness}
      <div className="grid grid-cols-1 gap-4 wide:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-group bg-card p-5" aria-label="Price">
            {asset.stream ? (
              <LivePrice stream={asset.stream} />
            ) : (
              <div className="flex items-center gap-3 text-row-detail text-muted-foreground">
                <Blocks aria-hidden className="size-5 text-foreground" />
                {market.kind === "event"
                  ? "Resolved from Zcash chain data, not from a price."
                  : "This market's price feed isn't connected yet."}
              </div>
            )}
          </section>
          <OddsPanel market={market} bundle={bundle} network={network} now={now} />
          <RulesPanel market={market} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <MarketFacts market={market} now={now} />
          <BatchHistory market={market} bundle={bundle} now={now} />
        </div>
      </div>
    </>
  );
}

function BrowseLink() {
  return (
    <Link href="/markets" className={buttonClass("secondary", "sm")}>
      Browse markets
    </Link>
  );
}

/** A link for the other network never opens silently in the wrong mode (senryo.md §5.3 deep links). */
function WrongNetwork({ wanted }: { wanted: Network }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <EmptyState
        icon={<Unplug />}
        title={`This market is on ${NETWORK_LABEL[wanted]}`}
        reason={`You're on ${NETWORK_LABEL[wanted === "mainnet" ? "testnet" : "mainnet"]}. Switch networks to open it; each network keeps its own markets and data on this device.`}
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => (wanted === "mainnet" ? setConfirming(true) : switchNetwork("testnet"))}
          >
            Switch to {NETWORK_LABEL[wanted]}
          </Button>
        }
      />
      <MainnetSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          switchNetwork("mainnet");
        }}
      />
    </>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading market" className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <SkeletonLine className="w-32" />
          <SkeletonLine small className="w-48" />
        </div>
      </div>
      <SkeletonLine className="h-8 w-3/4" />
      <div className="grid grid-cols-1 gap-4 wide:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 rounded-group" />
          <Skeleton className="h-44 rounded-group" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 rounded-group" />
          <Skeleton className="h-72 rounded-group" />
        </div>
      </div>
    </div>
  );
}
