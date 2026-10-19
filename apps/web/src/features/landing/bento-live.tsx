"use client";

import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { Mark } from "@kakure/ui-web";
import { Sparkline } from "@/features/chart/sparkline";
import { useMarkets } from "@/features/data/use-markets";
import { formatUsd } from "@/features/market/live-price";
import { assetFor } from "@/features/markets/assets";
import { WORDS } from "./words";

/** The bento's live islands: real sparklines and prices from the relay, and availability read from the signed batch. */
const CRYPTO: ReadonlyArray<{ symbol: string; stream: StreamSymbol }> = [
  { symbol: "BTC", stream: "BTC-USD" },
  { symbol: "ETH", stream: "ETH-USD" },
  { symbol: "SOL", stream: "SOL-USD" },
];

export function CryptoSparks() {
  return (
    <div className="mt-auto flex flex-col">
      {CRYPTO.map((row) => (
        <SparkRow key={row.symbol} symbol={row.symbol} stream={row.stream} />
      ))}
    </div>
  );
}

export function SparkRow({ symbol, stream }: { symbol: string; stream: StreamSymbol }) {
  const price = usePrice(stream);
  return (
    <div className="lp-spark-row">
      <span className="flex items-center gap-2 font-sans font-semibold">
        <Mark mark={`mark-${symbol.toLowerCase()}`} label={symbol} size="inline" />
        {symbol}
      </span>
      <Sparkline symbol={stream} className="h-8 w-full" />
      <span>{price.price ? formatUsd(price.price) : "—"}</span>
    </div>
  );
}

/** "Soon" until the signed batch lists a market of this kind; then nothing (the tile is live). */
export function SoonUnlessListed({ kind }: { kind: "strike" | "stock" }) {
  const data = useMarkets();
  if (data.status !== "ready") return null;
  const listed = data.bundle.markets.some((m) =>
    kind === "strike" ? Boolean(m.strike) : assetFor(m).category === "stocks",
  );
  return listed ? null : <span className="lp-sticker">{WORDS.bento.soon}</span>;
}
