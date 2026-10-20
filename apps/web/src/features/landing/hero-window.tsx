"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { cadenceLabel, type LaneAsset } from "@kakure/domain";
import { Mark, RollingNumber, Skeleton } from "@kakure/ui-web";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveWindowChart } from "@/features/chart/live-window-chart";
import { useRealtime } from "@/features/data/use-realtime";
import { assetFor } from "@/features/markets/assets";
import { heroPick, tradeHref } from "@/features/markets/live-lanes";
import { multipleOf, windowStatus } from "@/features/terminal/format";
import { pickWindow, useCommittedSpot, useQuote } from "@/features/terminal/use-window";
import { useNow } from "@/lib/time";
import { WORDS } from "./words";

/**
 * The live Window at the rim of the hole (plan §00: "the hero window card shows the shortest live Window"): picked once
 * the signed bundle is in and held, its Line, the price rolling in from the relay, Mitoshi's Window chart, and what Up
 * and Down pay at the house's live price. Every side opens the terminal on this asset and length.
 */
const MS = 1000;
const PERCENT = 100;
const CHANGE_DECIMALS = 2;

export function HeroWindow() {
  const data = useRealtime();
  const nowSec = Math.floor(useNow() / MS);
  const bundle = data.status === "ready" ? data.bundle : null;
  const [pick, setPick] = useState<{ asset: LaneAsset; cadenceSec: number } | null>(null);
  useEffect(() => {
    if (!pick && bundle && nowSec > 0) setPick(heroPick(bundle, nowSec));
  }, [pick, bundle, nowSec]);
  const w = WORDS.window;
  if (data.status === "loading" || (data.status === "ready" && !pick)) {
    return <Skeleton className="lp-window h-[22rem] rounded-lg" />;
  }
  if (!pick || !bundle) {
    return (
      <div className="lp-window">
        <p className="text-row-detail text-muted-foreground">{w.none}</p>
        <Link href="/markets" className="lp-btn lp-btn--glass lp-btn--sm">
          Markets <ArrowRight aria-hidden />
        </Link>
      </div>
    );
  }
  return <Card asset={pick.asset} cadenceSec={pick.cadenceSec} />;
}

function Card({ asset, cadenceSec }: { asset: LaneAsset; cadenceSec: number }) {
  const data = useRealtime();
  const bundle = data.status === "ready" ? data.bundle : null;
  const nowSec = Math.floor(useNow() / MS);
  const spot = useCommittedSpot(`${asset}-USD`);
  const screen = nowSec > 0 ? pickWindow(asset, cadenceSec, bundle, nowSec, new Set()) : null;
  const sigmaText = bundle?.pricing.sigma[asset];
  const quote = useQuote(screen, spot, sigmaText ? Number(sigmaText) : null, nowSec);
  const info = assetFor({ kind: "close", subject: asset });
  const w = WORDS.window;
  const line = screen?.state?.reference ? Number(screen.state.reference) : null;
  const change = spot !== null && line ? ((spot - line) / line) * PERCENT : null;
  const href = tradeHref(asset, cadenceSec);
  const usd = (n: number) => formatUsd(n, priceDecimals(n));
  const sides = [
    { word: w.up, sign: "▲", ask: quote?.up.askE4 ?? null, up: true },
    { word: w.down, sign: "▼", ask: quote?.down.askE4 ?? null, up: false },
  ];

  return (
    <article className="lp-window" aria-label={w.label(asset)}>
      <header className="flex items-center gap-3">
        <Mark mark={info.mark} label={asset} size="token" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-display text-[15px] font-bold">
            {asset}{" "}
            <span className="text-meta font-normal text-muted-foreground">· {w.length(cadenceLabel(cadenceSec))}</span>
          </div>
          <div className="font-mono text-[12px] text-muted-foreground tabular-nums">
            {windowStatus({
              phase: screen?.phase ?? null,
              startSec: screen?.window.startSec ?? null,
              cutoffSec: screen ? screen.window.expirySec - (bundle?.pricing.entryBufferSec ?? 0) : null,
              expirySec: screen?.window.expirySec ?? null,
              nowSec,
            })}
          </div>
        </div>
        {spot === null ? (
          <span className="text-meta text-muted-foreground">{w.connecting}</span>
        ) : (
          <div className="flex flex-col items-end">
            <RollingNumber value={usd(spot)} className="font-mono text-[17px] font-semibold" />
            {change === null ? null : (
              <span className={`font-mono text-[12px] ${change >= 0 ? "text-up" : "text-down"}`}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(CHANGE_DECIMALS)}%
              </span>
            )}
          </div>
        )}
      </header>
      {line !== null ? <p className="text-row-detail text-muted-foreground">{w.question(asset, usd(line))}</p> : null}
      {screen ? (
        <LiveWindowChart
          symbol={`${asset}-USD`}
          label={`${info.name} price over this ${cadenceLabel(cadenceSec)} Window`}
          className="lp-window-chart"
          spec={{
            opensAt: screen.window.startSec * MS,
            closesAt: screen.window.expirySec * MS,
            reference: line,
            referenceLabel: line === null ? "Line" : `Line ${usd(line)}`,
          }}
        />
      ) : null}
      <div className="lp-sides">
        {sides.map((side) => (
          <Link key={side.word} href={href} className={`lp-side ${side.up ? "lp-side--up" : "lp-side--down"}`}>
            <span>
              {side.sign} {side.word}
            </span>
            <small>{side.ask !== null ? w.pays(multipleOf(side.ask)) : w.notOffered}</small>
          </Link>
        ))}
      </div>
      <footer className="flex items-center justify-between gap-3 text-meta text-muted-foreground">
        <span>{w.house}</span>
        <Link href={href} className="flex shrink-0 items-center gap-1 font-semibold text-foreground hover:underline">
          {w.open} <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </footer>
    </article>
  );
}
