"use client";

import type { StreamSymbol } from "@kakure/feeds/protocol";
import { useEffect, useState } from "react";
import { loadBars } from "@/features/chart/bars";

/** The line's view box; the path scales to the element. */
const VIEW_W = 120;
const VIEW_H = 36;
const PAD = 2;
const LINE_MINUTES = 30;
const LINE_WIDTH = 1.5;

/**
 * The asset's last half hour of 1-minute closes (Mitoshi `BeatParts.tsx` CardLine), with your entry as a dashed
 * baseline once you've called it. The relay serves every symbol's bars in one file, so drawing it names no asset.
 */
export function CardLine({ asset, entry, className }: { asset: string; entry?: number | null; className?: string }) {
  const [points, setPoints] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBars().then((bars) => {
      if (!alive) return;
      const closes = (bars.oneMinute[`${asset}-USD` as StreamSymbol] ?? [])
        .slice(-LINE_MINUTES)
        .map(([, price]) => Number(price))
        .filter(Number.isFinite);
      setPoints(closes.length > 1 ? closes : null);
    });
    return () => {
      alive = false;
    };
  }, [asset]);

  if (!points) return <span aria-hidden className={`pr-line-empty ${className ?? ""}`} />;
  const all = entry ? [...points, entry] : points;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const yOf = (p: number) => PAD + ((max - p) / span) * (VIEW_H - PAD * 2);
  const step = (VIEW_W - PAD * 2) / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(PAD + i * step).toFixed(1)},${yOf(p).toFixed(1)}`)
    .join("");
  const up = (points.at(-1) ?? 0) >= (points[0] ?? 0);
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className={`pr-line ${className ?? ""}`}
      role="img"
      aria-label={`${asset}, last ${LINE_MINUTES} minutes: ${up ? "up" : "down"}`}
    >
      {entry ? (
        <line
          x1={0}
          x2={VIEW_W}
          y1={yOf(entry)}
          y2={yOf(entry)}
          className="pr-line-entry"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path
        d={path}
        fill="none"
        stroke={up ? "var(--up)" : "var(--down)"}
        strokeWidth={LINE_WIDTH}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
