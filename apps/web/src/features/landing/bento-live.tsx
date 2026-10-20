"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { Mark } from "@kakure/ui-web";
import { Sparkline } from "@/features/chart/sparkline";

/** The bento's live islands: real sparklines and prices from the relay, the same stream the terminal trades on. */
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
  const value = price.price ? Number(price.price) : null;
  return (
    <div className="lp-spark-row">
      <span className="flex items-center gap-2 font-sans font-semibold">
        <Mark mark={`mark-${symbol.toLowerCase()}`} label={symbol} size="inline" />
        {symbol}
      </span>
      <Sparkline symbol={stream} className="h-8 w-full" />
      <span>{value === null ? "—" : formatUsd(value, priceDecimals(value))}</span>
    </div>
  );
}
