"use client";

import { MIN_TAU_SEC, YEAR_SEC } from "@kakure/domain";
import { cx } from "@kakure/ui-web";
import { useId } from "react";

/**
 * The band over the model (Mitoshi's `BandCard`): the chance of each close across the track, from the same lognormal the
 * house prices with (σ and the time left), with the band shaded (inside, or the two tails for outside) and the price
 * marked. A picture of the bet, not an input; the presets and the centre control move it.
 */
const W = 600;
const H = 120;
const PAD_Y = 10;
const SAMPLES = 120;
const PRICE_TICK_W = 2;
const HALF = 0.5;

export function BandStrip({
  spot,
  lo,
  hi,
  side,
  trackLo,
  trackHi,
  sigma,
  secondsLeft,
  className,
}: {
  spot: number;
  lo: number | null;
  hi: number | null;
  side: "in" | "out";
  trackLo: number;
  trackHi: number;
  sigma: number;
  secondsLeft: number;
  className?: string;
}) {
  const clip = useId();
  const scale = sigma * Math.sqrt(Math.max(secondsLeft, MIN_TAU_SEC) / YEAR_SEC);
  const x = (price: number) => ((price - trackLo) / (trackHi - trackLo)) * W;
  const density = (price: number) => {
    const z = Math.log(price / spot) / scale;
    // The lognormal's shape (its constant factor cancels against the peak).
    return Math.exp(-HALF * z * z) / (price * scale);
  };
  const prices = Array.from({ length: SAMPLES + 1 }, (_, i) => trackLo + ((trackHi - trackLo) * i) / SAMPLES);
  const peak = Math.max(...prices.map(density));
  const y = (price: number) => H - PAD_Y - (density(price) / peak) * (H - PAD_Y * 2);
  const curve = prices.map((p, i) => `${i === 0 ? "M" : "L"}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = `${curve} L${W},${H} L0,${H} Z`;
  const loX = lo === null ? 0 : Math.max(0, Math.min(W, x(lo)));
  const hiX = hi === null ? W : Math.max(0, Math.min(W, x(hi)));
  const spotX = x(spot);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className={cx("h-28 w-full overflow-visible", className)}
    >
      <defs>
        <clipPath id={clip}>
          {side === "in" ? (
            <rect x={loX} y={0} width={Math.max(0, hiX - loX)} height={H} />
          ) : (
            <>
              <rect x={0} y={0} width={loX} height={H} />
              <rect x={hiX} y={0} width={Math.max(0, W - hiX)} height={H} />
            </>
          )}
        </clipPath>
      </defs>
      <path d={area} className="fill-secondary" />
      <path d={area} clipPath={`url(#${clip})`} className="fill-up/25" />
      <path
        d={curve}
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {lo !== null ? (
        <line x1={loX} x2={loX} y1={0} y2={H} className="stroke-up" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ) : null}
      {hi !== null ? (
        <line x1={hiX} x2={hiX} y1={0} y2={H} className="stroke-up" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ) : null}
      <rect x={spotX - PRICE_TICK_W / 2} y={0} width={PRICE_TICK_W} height={H} className="fill-foreground" />
    </svg>
  );
}
