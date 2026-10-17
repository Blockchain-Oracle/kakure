"use client";

import type { Market, Network } from "@kakure/domain";
import { Mark, PartitionBar, Pill } from "@kakure/ui-web";
import { Lock } from "lucide-react";
import Link from "next/link";
import { NETWORK_COIN } from "@/constants";
import { formatCountdown, formatShortWhen } from "@/lib/time";
import { assetFor } from "./assets";
import { coinAmount, isBettable, releasedOdds, sealedLine, shortTitle, statePill, WINDOW_LABEL } from "./market-view";

/**
 * A market card, adapted from 21st.dev isaiahbjork/prediction-market-card (#2537): asset mark, question, a live
 * countdown and the two-sided bar. Reskin: a `card` plate with no border, gradient or glow; the team logo becomes
 * the asset's real mark; the bank figures become the last released batch (never live per-bet odds); when the odds
 * are sealed the card says so instead of drawing a split (D3). The whole card links to `/m#<network>/<id>`, so the
 * market id stays in the fragment and never reaches the host (PD14).
 */
export function MarketCard({ market, network, now }: { market: Market; network: Network; now: number }) {
  const asset = assetFor(market);
  const pill = statePill(market, now);
  const odds = releasedOdds(market);
  const open = isBettable(market, now);
  const cutoffIn = Date.parse(market.cutoffAt) - now;

  return (
    <Link
      href={`/m#${network}/${market.id}`}
      className="kk-press group flex flex-col gap-4 rounded-group bg-card p-5 text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3">
        <Mark src={asset.mark} label={asset.symbol} />
        <div className="min-w-0 flex-1">
          <div className="text-row-strong text-foreground">{asset.symbol}</div>
          <div className="truncate text-meta text-muted-foreground">
            {asset.name} · {WINDOW_LABEL[market.window]}
          </div>
        </div>
        <Pill tone={pill.tone} indicator={pill.pulse ? "pulse" : false}>
          {pill.label}
        </Pill>
      </div>

      <h3 className="text-row-title text-foreground">{shortTitle(market, asset.symbol)}</h3>

      <div className="flex items-baseline justify-between gap-3 text-row-detail">
        {open ? (
          <span className="whitespace-nowrap text-muted-foreground">
            Betting closes in{" "}
            <span className="font-semibold text-foreground tabular-nums" suppressHydrationWarning>
              {formatCountdown(cutoffIn)}
            </span>
          </span>
        ) : market.state === "scheduled" ? (
          <span className="text-muted-foreground">Betting opens {formatShortWhen(market.opensAt, now)}</span>
        ) : (
          <span className="text-muted-foreground">Betting closed {formatShortWhen(market.cutoffAt, now)}</span>
        )}
        <span className="shrink-0 text-muted-foreground">Closes {formatShortWhen(market.closesAt, now)}</span>
      </div>

      {odds ? (
        <PartitionBar
          label={`Last released odds, batch ${odds.seq}`}
          segments={odds.sides.map((side) => ({
            key: side.side,
            value: Number(side.zat),
            tone: side.side === "U" || side.side === "Y" ? "up" : "down",
            title: `${side.sign} ${side.word} ${side.percent}%`,
            detail: `${coinAmount(side.zat, NETWORK_COIN[network])}${side.multiple ? ` · pays ${side.multiple}` : ""}`,
          }))}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-row bg-secondary px-3 py-2.5 text-row-detail text-secondary-foreground">
          <Lock aria-hidden className="size-4 shrink-0" />
          <span>{sealedLine(market)}</span>
        </div>
      )}
    </Link>
  );
}
