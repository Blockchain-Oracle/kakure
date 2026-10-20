"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import "./kit.css";

/**
 * A marquee (Mitoshi `components/kit/InfiniteSlider.tsx`, from 21st.dev grootstudio's Logo Marquee): the children
 * twice, slid by one copy's measured width at a constant speed on the Web Animations API, slowing (not stopping) under
 * the pointer. `still` (the games' reduced motion) stands it still and lets it scroll by hand. The copy is inert.
 */
const MS_PER_SEC = 1000;

export function InfiniteSlider({
  children,
  gapRem,
  durationSec,
  hoverDurationSec,
  still,
}: {
  children: ReactNode;
  gapRem: number;
  /** Seconds for one copy to pass. */
  durationSec: number;
  hoverDurationSec: number;
  still: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const run = useRef<Animation | null>(null);

  useEffect(() => {
    const el = track.current;
    if (!el || still) return;
    const start = () => {
      run.current?.cancel();
      const gap = gapRem * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const span = (el.scrollWidth + gap) / 2;
      if (span <= 0) return;
      run.current = el.animate([{ translate: "0 0" }, { translate: `${-span}px 0` }], {
        duration: durationSec * MS_PER_SEC,
        iterations: Number.POSITIVE_INFINITY,
        easing: "linear",
      });
    };
    start();
    const observer = new ResizeObserver(start);
    observer.observe(el);
    return () => {
      observer.disconnect();
      run.current?.cancel();
      run.current = null;
    };
  }, [still, gapRem, durationSec]);

  const slow = (on: boolean) => run.current?.updatePlaybackRate(on ? durationSec / hoverDurationSec : 1);

  return (
    <div
      className="gm-slider"
      data-still={still ? "" : undefined}
      style={{ "--gm-gap": `${gapRem}rem` } as CSSProperties}
      onPointerEnter={() => slow(true)}
      onPointerLeave={() => slow(false)}
    >
      <div ref={track} className="gm-slider-track">
        {children}
        <div aria-hidden inert className="gm-slider-track">
          {children}
        </div>
      </div>
    </div>
  );
}
