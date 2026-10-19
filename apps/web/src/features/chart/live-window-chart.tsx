"use client";

import { WindowChart, type WindowSpec } from "@kakure/chart";
import { sharedPrices } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { useEffect, useRef } from "react";
import { loadBars } from "./bars";

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
