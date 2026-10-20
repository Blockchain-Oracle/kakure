"use client";

import { type BundleV2, cadenceLabel, type LaneAsset, type Network } from "@kakure/domain";
import { Button, EmptyState, SearchField, Tabs } from "@kakure/ui-web";
import { Hourglass, RefreshCw, SearchX } from "lucide-react";
import { useEffect, useState } from "react";
import { NETWORK_LABEL } from "@/constants";
import { DataErrorState } from "@/features/data/data-states";
import { useRealtime } from "@/features/data/use-realtime";
import { useFragment } from "@/features/market/fragment";
import { switchNetwork } from "@/features/network/network-store";
import { TradeToasts } from "@/features/terminal/toasts";
import { useUpkeep } from "@/features/terminal/use-upkeep";
import { LANE_SYMBOLS, useCommittedSpots } from "@/features/terminal/use-window";
import { DepositSheet } from "@/features/wallet/deposit-sheet";
import { useWallet } from "@/features/wallet/wallet-store";
import { formatClock, useNow } from "@/lib/time";
import { assetFor } from "./assets";
import { heroPick, LENGTHS, laneCards, liveCount } from "./live-lanes";
import { MarketsSkeleton } from "./markets-skeleton";
import { WindowCard } from "./window-card";
import { WindowHero } from "./window-hero";
import "@/features/terminal/terminal.css";

/**
 * Markets (plan §00 Markets; Mitoshi's markets page, mitoshi-code-study §3.1): the shortest Window open now as a live
 * hero you can trade from here, then the lanes by Window length (1m … 1d, never by date) with each asset's card:
 * live price against its Line, a 24-hour sparkline, and what Up and Down pay now. A card opens the terminal on that
 * asset and length. The length lives in the fragment (`/markets#5m`), which the host never sees.
 */
const GRID_ID = "window-grid";
const MS = 1000;

export function MarketsScreen() {
  const data = useRealtime();
  const network = data.network;
  const bundle = data.status === "ready" ? data.bundle : null;
  const nowSec = Math.floor(useNow() / MS);
  const spots = useCommittedSpots(LANE_SYMBOLS);
  const wallet = useWallet(network);
  const fragment = useFragment();
  const [query, setQuery] = useState("");
  const [depositOpen, setDepositOpen] = useState(false);
  // The hero is chosen once the bundle is in, then held (a 1-minute Window stops trading every half minute).
  const [hero, setHero] = useState<{ asset: LaneAsset; cadenceSec: number } | null>(null);
  useEffect(() => {
    if (!hero && bundle && nowSec > 0) setHero(heroPick(bundle, nowSec));
  }, [hero, bundle, nowSec]);

  // A link's length (`/markets#5m`) wins; a tapped tab is written back (replaceState doesn't render, so it's held too).
  const [picked, setPicked] = useState<number | null>(null);
  const linked = LENGTHS.find((sec) => `#${cadenceLabel(sec)}` === fragment) ?? null;
  const length = linked ?? picked ?? hero?.cadenceSec ?? LENGTHS[0] ?? null;
  const pickLength = (sec: number) => {
    setPicked(sec);
    history.replaceState(null, "", `#${cadenceLabel(sec)}`);
  };
  // A position bought from the hero settles and pays out from here too.
  useUpkeep(network, bundle?.trading ?? null, wallet.positions, wallet.status === "ready");
  const arriving =
    wallet.deposits.filter((d) => d.state !== "done").sort((a, b) => b.createdAt - a.createdAt)[0]?.key ?? null;

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-page-title text-foreground">Markets</h1>
        {bundle ? (
          <p className="text-money-meta text-muted-foreground">
            Signed {formatClock(bundle.publishedAt)} · every minute
          </p>
        ) : null}
      </div>

      {data.status === "ready" && hero ? (
        <WindowHero
          network={network}
          bundle={bundle}
          asset={hero.asset}
          cadenceSec={hero.cadenceSec}
          spot={spots.get(`${hero.asset}-USD`) ?? null}
          nowSec={nowSec}
          onNeedChips={() => setDepositOpen(true)}
        />
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {length !== null ? (
          <Tabs
            label="Window length"
            controls={GRID_ID}
            value={cadenceLabel(length)}
            onChange={(label) => {
              const sec = LENGTHS.find((s) => cadenceLabel(s) === label);
              if (sec !== undefined) pickLength(sec);
            }}
            items={LENGTHS.map((sec) => ({
              value: cadenceLabel(sec),
              label: cadenceLabel(sec),
              ...(bundle ? { count: liveCount(sec, bundle, nowSec) } : {}),
            }))}
          />
        ) : null}
        <SearchField
          label="Search markets"
          placeholder="Search BTC, Zcash…"
          value={query}
          onChange={setQuery}
          className="md:w-56"
        />
      </div>

      <section id={GRID_ID} aria-live="polite">
        {data.status === "loading" ? <MarketsSkeleton /> : null}
        {data.status === "error" ? (
          <DataErrorState error={data.error} network={network} onRetry={data.refetch} />
        ) : null}
        {data.status === "unpublished" ? <Unpublished network={network} onRetry={data.refetch} /> : null}
        {data.status === "ready" && length !== null ? (
          <WindowGrid
            bundle={data.bundle}
            length={length}
            query={query}
            nowSec={nowSec}
            spots={spots}
            onClear={() => setQuery("")}
          />
        ) : null}
      </section>

      <TradeToasts />
      {bundle?.trading ? (
        <DepositSheet
          open={depositOpen}
          onClose={() => setDepositOpen(false)}
          network={network}
          trading={bundle.trading}
          resume={arriving}
        />
      ) : null}
    </div>
  );
}

function WindowGrid({
  bundle,
  length,
  query,
  nowSec,
  spots,
  onClear,
}: {
  bundle: BundleV2;
  length: number;
  query: string;
  nowSec: number;
  spots: ReadonlyMap<string, number>;
  onClear: () => void;
}) {
  const q = query.trim().toLowerCase();
  const cards = laneCards(length, bundle, nowSec).filter((c) => {
    if (!q) return true;
    const name = assetFor({ kind: "close", subject: c.asset }).name.toLowerCase();
    return c.asset.toLowerCase().includes(q) || name.includes(q);
  });
  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<SearchX />}
        title="No market matches"
        reason={`Nothing on the ${cadenceLabel(length)} Windows matches "${query}".`}
        action={
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear search
          </Button>
        }
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 wide:grid-cols-3">
      {cards.map((card) => {
        const sigma = bundle.pricing.sigma[card.asset];
        return (
          <li key={card.asset}>
            <WindowCard
              card={card}
              spot={spots.get(`${card.asset}-USD`) ?? null}
              sigma={sigma ? Number(sigma) : null}
              nowSec={nowSec}
              entryBufferSec={bundle.pricing.entryBufferSec}
            />
          </li>
        );
      })}
    </ul>
  );
}

function Unpublished({ network, onRetry }: { network: Network; onRetry: () => void }) {
  return (
    <EmptyState
      icon={<Hourglass />}
      title="No Windows published yet"
      reason={`The operator hasn't published a signed bundle for ${NETWORK_LABEL[network]} yet. Bundles go out every minute, and this page checks again on its own.`}
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
