"use client";

import type { Market } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { Mark } from "@kakure/ui-web";
import Link from "next/link";
import { useMarkets } from "@/features/data/use-markets";
import { formatUsd } from "@/features/market/live-price";
import { assetFor } from "@/features/markets/assets";
import { isBettable, releasedOdds, WINDOW_LABEL } from "@/features/markets/market-view";
import { useNow } from "@/lib/time";
import { WORDS } from "./words";

/**
 * The live tape (Mitoshi's tape; 21st.dev lukacho/marquee): every open window in the signed batch with its live
 * price from the relay and its odds, or "sealed". Two copies slide in CSS and pause on hover or focus; with reduced
 * motion it stands still. No batch, no tape.
 */
export function Tape() {
  const data = useMarkets();
  const now = useNow();
  if (data.status !== "ready") return null;
  const open = data.bundle.markets.filter((m) => isBettable(m, now) && m.kind === "close");
  if (open.length === 0) return null;
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
              {open.map((market) => (
                <Tick key={`${copy}-${market.id}`} market={market} href={`/trade#${data.network}/${market.id}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tick({ market, href }: { market: Market; href: string }) {
  const asset = assetFor(market);
  const odds = releasedOdds(market);
  return (
    <Link href={href} className="lp-tick">
      <Mark mark={asset.mark} label={asset.symbol} size="inline" />
      <span className="font-sans font-semibold text-foreground">{asset.symbol}</span>
      <span className="text-muted-foreground">{WINDOW_LABEL[market.window]}</span>
      {asset.stream ? <Spot stream={asset.stream} /> : null}
      <span className="text-muted-foreground">
        {odds ? odds.sides.map((side) => `${side.sign}${side.percent}%`).join(" ") : "sealed"}
      </span>
    </Link>
  );
}

function Spot({ stream }: { stream: StreamSymbol }) {
  const price = usePrice(stream);
  return <span className="text-foreground">{price.price ? formatUsd(price.price) : "—"}</span>;
}
