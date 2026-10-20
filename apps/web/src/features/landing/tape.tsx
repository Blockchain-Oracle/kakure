"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { type BundleV2, cadenceLabel, LANE_ASSETS, type LaneAsset, quoteWindow } from "@kakure/domain";
import { Mark } from "@kakure/ui-web";
import Link from "next/link";
import { useRealtime } from "@/features/data/use-realtime";
import { assetFor } from "@/features/markets/assets";
import { LENGTHS, tradeHref } from "@/features/markets/live-lanes";
import { multipleOf } from "@/features/terminal/format";
import { LANE_SYMBOLS, pickWindow, type ScreenWindow, useCommittedSpots } from "@/features/terminal/use-window";
import { useNow } from "@/lib/time";
import { WORDS } from "./words";

/**
 * The live tape (Mitoshi's tape; 21st.dev lukacho/marquee): every asset's shortest Window trading now, with its live
 * price from the relay and what Up and Down pay at the house's price. Two copies slide in CSS and pause on hover or
 * focus; with reduced motion it stands still. No bundle, no tape.
 */
const MS = 1000;

interface Tick {
  asset: LaneAsset;
  cadenceSec: number;
  screen: ScreenWindow;
}

function ticksOf(bundle: BundleV2, nowSec: number): Tick[] {
  return LANE_ASSETS.flatMap((asset) => {
    for (const cadenceSec of LENGTHS) {
      const screen = pickWindow(asset, cadenceSec, bundle, nowSec, new Set());
      if (screen?.phase === "live") return [{ asset, cadenceSec, screen }];
    }
    return [];
  });
}

export function Tape() {
  const data = useRealtime();
  const nowSec = Math.floor(useNow() / MS);
  const spots = useCommittedSpots(LANE_SYMBOLS);
  if (data.status !== "ready" || nowSec === 0) return null;
  const ticks = ticksOf(data.bundle, nowSec);
  if (ticks.length === 0) return null;
  return (
    <section aria-label={WORDS.tape.label} className="flex flex-col gap-3 pb-4">
      <div className="lp-wrap flex items-center justify-between">
        <span className="lp-kicker">{WORDS.tape.label}</span>
        <span className="font-mono text-[12px] text-muted-foreground">{WORDS.tape.signed(data.bundle.seq)}</span>
      </div>
      <div className="lp-tape">
        <div className="lp-tape-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex gap-2.5" aria-hidden={copy === 1} inert={copy === 1}>
              {ticks.map((tick) => {
                const spot = spots.get(`${tick.asset}-USD`) ?? null;
                const sigma = data.bundle.pricing.sigma[tick.asset];
                const quote = quoteWindow(
                  tick.screen.window,
                  tick.screen.state,
                  { spot, sigma: sigma ? Number(sigma) : null },
                  nowSec,
                );
                return (
                  <Link key={`${copy}-${tick.asset}`} href={tradeHref(tick.asset, tick.cadenceSec)} className="lp-tick">
                    <Mark
                      mark={assetFor({ kind: "close", subject: tick.asset }).mark}
                      label={tick.asset}
                      size="inline"
                    />
                    <span className="font-sans font-semibold text-foreground">{tick.asset}</span>
                    <span className="text-muted-foreground">{cadenceLabel(tick.cadenceSec)}</span>
                    <span className="text-foreground">
                      {spot === null ? "—" : formatUsd(spot, priceDecimals(spot))}
                    </span>
                    <span className="text-muted-foreground">
                      ▲{quote.up.askE4 ? multipleOf(quote.up.askE4) : "–"} ▼
                      {quote.down.askE4 ? multipleOf(quote.down.askE4) : "–"}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
