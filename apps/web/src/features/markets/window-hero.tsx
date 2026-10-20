"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { type BundleV2, cadenceLabel, type LaneAsset, type Network } from "@kakure/domain";
import { cx, Mark } from "@kakure/ui-web";
import { ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { LiveWindowChart } from "@/features/chart/live-window-chart";
import { windowStatus } from "@/features/terminal/format";
import { pickWindow, useQuote } from "@/features/terminal/use-window";
import { assetFor } from "./assets";
import { tradeHref } from "./live-lanes";

/** The trading half (wallet, relay client, mint crypto) loads after the page; the same height holds its place. */
const HeroTrade = dynamic(() => import("./hero-trade"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-16" />,
});

/**
 * The Markets hero (Mitoshi's hero, mitoshi-code-study §3.1; plan §00 "the shortest Window open now"): the Window as a
 * live picture (from the open to the close, the Line it has to beat, the price rolling in), where it stands, and UP /
 * DOWN at the house's live price, bought right here (`hero-trade.tsx`, loaded after the page). A position on this
 * Window is managed in the terminal, one tap away.
 */
const PERCENT = 100;
const CHANGE_DECIMALS = 2;
const MS = 1000;

export function WindowHero({
  network,
  bundle,
  asset,
  cadenceSec,
  spot,
  nowSec,
}: {
  network: Network;
  bundle: BundleV2 | null;
  asset: LaneAsset;
  cadenceSec: number;
  spot: number | null;
  nowSec: number;
}) {
  const info = assetFor({ kind: "close", subject: asset });
  const screen = nowSec > 0 ? pickWindow(asset, cadenceSec, bundle, nowSec, new Set()) : null;
  const sigmaText = bundle?.pricing.sigma[asset];
  const quote = useQuote(screen, spot, sigmaText ? Number(sigmaText) : null, nowSec);

  const line = screen?.state?.reference ? Number(screen.state.reference) : null;
  const away = spot !== null && line !== null && line > 0 ? ((spot - line) / line) * PERCENT : null;
  const entryBufferSec = bundle?.pricing.entryBufferSec ?? 0;
  const href = tradeHref(asset, cadenceSec);

  return (
    <article
      aria-label={`${info.name} ${cadenceLabel(cadenceSec)} Window`}
      className="flex flex-col gap-4 rounded-group border border-border bg-card p-4 md:p-5"
    >
      <header className="flex items-center gap-3">
        <Mark mark={info.mark} label={asset} size="token" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-title text-foreground">
            {asset} · {cadenceLabel(cadenceSec)} Window
          </h2>
          <p className="numbers truncate text-meta text-muted-foreground">
            {windowStatus({
              phase: screen?.phase ?? null,
              startSec: screen?.window.startSec ?? null,
              cutoffSec: screen ? screen.window.expirySec - entryBufferSec : null,
              expirySec: screen?.window.expirySec ?? null,
              nowSec,
            })}
            {line !== null ? ` · Line ${formatUsd(line, priceDecimals(line))}` : ""}
          </p>
        </div>
        <Link
          href={href}
          aria-label="Open the terminal"
          className="flex size-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-secondary text-chip-label text-foreground hover:bg-row-pressed sm:w-auto sm:px-3.5"
        >
          <span className="hidden sm:inline">Terminal</span> <ArrowRight aria-hidden className="size-4" />
        </Link>
      </header>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="numbers whitespace-nowrap font-display text-page-title text-foreground">
          {spot === null ? "—" : formatUsd(spot, priceDecimals(spot))}
        </span>
        <span
          className={cx(
            "numbers whitespace-nowrap text-row-strong",
            away === null ? "text-muted-foreground" : away >= 0 ? "text-up" : "text-down",
          )}
        >
          {away === null
            ? "Line sets at the open"
            : `${away >= 0 ? "▲" : "▼"} ${Math.abs(away).toFixed(CHANGE_DECIMALS)}% vs the Line`}
        </span>
      </div>

      {screen ? (
        <LiveWindowChart
          symbol={`${asset}-USD`}
          spec={{
            opensAt: screen.window.startSec * MS,
            closesAt: screen.window.expirySec * MS,
            reference: line,
            referenceLabel: "Line",
          }}
          className="h-56 w-full md:h-64"
          label={`${info.name} price over this ${cadenceLabel(cadenceSec)} Window`}
        />
      ) : (
        <div className="h-56 rounded-row bg-secondary md:h-64" />
      )}

      <HeroTrade
        network={network}
        bundle={bundle}
        asset={asset}
        cadenceSec={cadenceSec}
        screen={screen}
        quote={quote}
        spot={spot}
      />
    </article>
  );
}
