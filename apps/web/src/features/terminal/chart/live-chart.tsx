"use client";

import {
  CandleView,
  ChartEngine,
  type ChartOverlay,
  type ChartTheme,
  type ChartView,
  DotGrid,
  type FrameInfo,
} from "@kakure/chart";
import { sharedPrices } from "@kakure/feeds";
import type { CandleInterval, StreamSymbol } from "@kakure/feeds/protocol";
import { cx } from "@kakure/ui-web";
import { type RefObject, useEffect, useRef } from "react";
import { PRICE_RELAY } from "@/constants";

/**
 * The terminal's live chart (Owarine `chart/LiveChart.tsx`) on Kakure's tokens: a parallax dot field and the live line,
 * each its own canvas at ≤2× device resolution, one continuous animation loop. Every streamed tick goes straight to the
 * engine; nothing here re-renders per tick.
 */
export type { ChartLevel, ChartOverlay, FrameInfo } from "@kakure/chart";

/** What the controls ask of the chart: whether the candle view is panned away, and to come back. */
export interface ChartHandle {
  offCentre(): boolean;
  recentre(): void;
}

export interface LiveChartProps {
  symbol: StreamSymbol;
  /** The open position's overlay, written by the parent, read every frame. */
  overlay?: RefObject<ChartOverlay | null>;
  /** Every frame's head position and motion, for the reaction overlay. */
  onFrame?: RefObject<((info: FrameInfo | null) => void) | null>;
  view?: ChartView;
  interval?: CandleInterval;
  handle?: RefObject<ChartHandle | null>;
  /** A tick on each crosshair detent (haptics). */
  onDetent?: () => void;
  className?: string;
  label: string;
}

function readTheme(el: Element): { chart: ChartTheme; dots: string } {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    chart: {
      up: v("--up"),
      down: v("--down"),
      ink: v("--foreground"),
      inverse: v("--stage"),
      helper: v("--muted-foreground"),
      onLine: v("--on-fill"),
      breakeven: v("--chart-breakeven"),
      axisFont: v("--chart-axis-font"),
      pillFont: v("--chart-pill-font"),
      pillPriceFont: v("--chart-pill-price-font"),
      pillPnlFont: v("--chart-pill-pnl-font"),
      tagFont: v("--chart-tag-font"),
      tagStrongFont: v("--chart-tag-strong-font"),
      markFont: v("--chart-mark-font"),
    },
    dots: v("--chart-dots"),
  };
}

export function LiveChart({
  symbol,
  overlay,
  onFrame,
  view = "line",
  interval = "1m",
  handle,
  onDetent,
  className,
  label,
}: LiveChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const lineRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const detentRef = useRef(onDetent);
  detentRef.current = onDetent;

  // The engine lives for the component; a symbol change resets it instead of rebuilding it.
  useEffect(() => {
    const box = boxRef.current;
    const dotsCanvas = dotsRef.current;
    const lineCanvas = lineRef.current;
    if (!box || !dotsCanvas || !lineCanvas) return;
    let theme = readTheme(box);
    const engine = new ChartEngine(lineCanvas, theme.chart, symbol.replace("-USD", ""));
    const dots = new DotGrid(dotsCanvas, theme.dots);
    engineRef.current = engine;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const resize = () => {
      engine.resize();
      dots.resize();
    };
    const loop = (now: number) => {
      engine.setOverlay(overlay?.current ?? null);
      const info = engine.frame(now);
      dots.frame(info, reduced.matches);
      onFrame?.current?.(info);
      raf = requestAnimationFrame(loop);
    };
    resize();
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const mo = new MutationObserver(() => {
      theme = readTheme(box);
      engine.setTheme(theme.chart);
      dots.setColour(theme.dots);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.reset(symbol.replace("-USD", ""));
    const stream = sharedPrices();
    stream?.start();
    const feed = () => {
      const state = stream?.get(symbol);
      if (state?.price) engineRef.current?.setPrice(Number(state.price));
    };
    feed();
    return stream?.subscribe(symbol, feed);
  }, [symbol]);

  // The candle view: built per symbol and interval, gestures on the line canvas; line view drops it.
  useEffect(() => {
    const engine = engineRef.current;
    const canvas = lineRef.current;
    if (!engine || !canvas) return;
    if (view === "line") {
      engine.setView("line", null);
      if (handle) handle.current = { offCentre: () => false, recentre: () => undefined };
      return;
    }
    const candles = new CandleView(symbol, interval, PRICE_RELAY.replace(/\/$/, ""), () => detentRef.current?.());
    const stop = candles.start();
    const detach = candles.attach(canvas, () => engine.geometry());
    engine.setView("candles", candles);
    if (handle) handle.current = { offCentre: () => candles.offCentre, recentre: () => candles.recentre() };
    return () => {
      stop();
      detach();
    };
  }, [view, interval, symbol, handle]);

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label={label}
      className={cx("kk-terminal relative h-full w-full overflow-hidden", className)}
    >
      <canvas ref={dotsRef} className="absolute inset-0 block h-full w-full" aria-hidden />
      <canvas
        ref={lineRef}
        className={cx("absolute inset-0 block h-full w-full", view === "candles" && "touch-none")}
        aria-hidden
      />
    </div>
  );
}
