"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { cadenceLabel, quoteWindow } from "@kakure/domain";
import { cx, Mark } from "@kakure/ui-web";
import Link from "next/link";
import { Sparkline } from "@/features/chart/sparkline";
import { multipleOf, windowStatus } from "@/features/terminal/format";
import { assetFor } from "./assets";
import { type LaneCard, tradeHref } from "./live-lanes";

/**
 * A Window card (Mitoshi's MarketCard, mitoshi-code-study §3.1, on real-time Windows): the asset's mark and length, where
 * its Window is ("trades 0:23"), the live price with how far it sits from the Line, a 24-hour sparkline, and what Up
 * and Down pay now, moving with the price. The whole card opens the terminal on this asset and length.
 */
const PERCENT = 100;
const CHANGE_DECIMALS = 2;

export function WindowCard({
  card,
  spot,
  sigma,
  nowSec,
  entryBufferSec,
}: {
  card: LaneCard;
  spot: number | null;
  sigma: number | null;
  nowSec: number;
  entryBufferSec: number;
}) {
  const info = assetFor({ kind: "close", subject: card.asset });
  const screen = card.screen;
  const quote = screen ? quoteWindow(screen.window, screen.state, { spot, sigma }, nowSec) : null;
  const line = screen?.state?.reference ? Number(screen.state.reference) : null;
  const away = spot !== null && line !== null && line > 0 ? ((spot - line) / line) * PERCENT : null;
  const status = windowStatus({
    phase: screen?.phase ?? null,
    startSec: screen?.window.startSec ?? null,
    cutoffSec: screen ? screen.window.expirySec - entryBufferSec : null,
    expirySec: screen?.window.expirySec ?? null,
    nowSec,
  });
  const sides = [
    { word: "Up", ask: quote?.up.askE4 ?? null, other: quote?.down.askE4 ?? null, tone: "kk-up-soft" },
    { word: "Down", ask: quote?.down.askE4 ?? null, other: quote?.up.askE4 ?? null, tone: "kk-down-soft" },
  ];

  return (
    <Link
      href={tradeHref(card.asset, card.cadenceSec)}
      className="kk-press group flex flex-col gap-3 rounded-group border border-border bg-card p-4 text-card-foreground outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2.5">
        <Mark mark={info.mark} label={card.asset} size="row" />
        <div className="min-w-0 flex-1">
          <div className="text-body-strong text-foreground">{card.asset}</div>
          <div className="truncate text-meta text-muted-foreground">
            {info.name} · {cadenceLabel(card.cadenceSec)} Window
          </div>
        </div>
        <span
          className={cx(
            "numbers shrink-0 rounded-full px-2.5 py-1 text-meta",
            screen?.phase === "live" ? "bg-secondary text-foreground" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="numbers text-row-strong text-foreground">
            {spot === null ? "—" : formatUsd(spot, priceDecimals(spot))}
          </div>
          <div
            className={cx(
              "numbers text-meta",
              away === null ? "text-muted-foreground" : away >= 0 ? "text-up" : "text-down",
            )}
          >
            {away === null
              ? "Line sets at the open"
              : `${away >= 0 ? "▲" : "▼"} ${Math.abs(away).toFixed(CHANGE_DECIMALS)}% ${away >= 0 ? "above" : "below"} the Line`}
          </div>
        </div>
        <Sparkline symbol={`${card.asset}-USD`} className="h-9 w-28 shrink-0" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {sides.map((s) => (
          <span
            key={s.word}
            className={cx(
              "numbers flex h-10 items-center justify-between rounded-full px-3.5 text-meta font-bold",
              s.ask === null ? "bg-secondary text-muted-foreground" : s.tone,
            )}
          >
            <span>{s.word}</span>
            <span>{s.ask !== null ? `pays ${multipleOf(s.ask)}` : s.other !== null ? "not offered" : "—"}</span>
          </span>
        ))}
      </div>
    </Link>
  );
}
