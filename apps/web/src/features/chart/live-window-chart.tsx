"use client";

import { WindowChart, type WindowSpec } from "@kakure/chart";
import { sharedPrices } from "@kakure/feeds";
import { fetchBars } from "@kakure/feeds/client";
import type { BarsResponse, StreamSymbol } from "@kakure/feeds/protocol";
import { useEffect, useRef } from "react";
import { PRICE_RELAY } from "@/constants";

/** One bars request per page load, shared by every chart (all symbols in one file: PD19). */
const BARS_TTL_MS = 30_000;
let bars: { at: number; promise: Promise<BarsResponse> } | null = null;
function loadBars(): Promise<BarsResponse> {
  if (!bars || Date.now() - bars.at > BARS_TTL_MS) bars = { at: Date.now(), promise: fetchBars(PRICE_RELAY) };
  return bars.promise;
}

/**
 * The live Window chart for one market: history from the relay's bars, then every tick drawn as it arrives.
 * Ticks never re-render React; the canvas engine (@kakure/chart) reads them directly from the shared stream.
 */
export function LiveWindowChart({
  symbol,
  spec,
  className,
  label,
}: {
  symbol: StreamSymbol;
  spec: WindowSpec;
  className?: string;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<WindowChart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new WindowChart(canvas);
    chartRef.current = chart;
    let alive = true;
    void loadBars().then((all) => {
      if (!alive) return;
      const minute = all.oneMinute[symbol] ?? [];
      const firstMinute = minute[0]?.[0] ?? Number.POSITIVE_INFINITY;
      const older = (all.fiveMinute[symbol] ?? []).filter(([ts]) => ts < firstMinute);
      chart.setHistory([...older, ...minute].map(([ts, price]) => [ts, Number(price)] as const));
    });
    const stream = sharedPrices();
    stream?.start();
    const take = () => {
      const state = stream?.get(symbol);
      if (state?.price && state.ts) chart.push(state.ts, Number(state.price));
    };
    take();
    const unsubscribe = stream?.subscribe(symbol, take);
    return () => {
      alive = false;
      unsubscribe?.();
      chart.destroy();
      chartRef.current = null;
    };
  }, [symbol]);

  const { opensAt, closesAt, reference, referenceLabel } = spec;
  useEffect(() => {
    chartRef.current?.setWindow({ opensAt, closesAt, reference, referenceLabel });
  }, [opensAt, closesAt, reference, referenceLabel]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={label} />;
}
