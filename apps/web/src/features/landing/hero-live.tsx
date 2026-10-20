"use client";

import dynamic from "next/dynamic";
import { type CSSProperties, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { useRealtime } from "@/features/data/use-realtime";
import { LENGTHS, liveCount } from "@/features/markets/live-lanes";
import { formatClock, useNow } from "@/lib/time";
import type { BlackHoleView } from "./black-hole/black-hole";
import { VIEWS } from "./black-hole/constants";
import { HeroWindow } from "./hero-window";
import { WORDS } from "./words";

/**
 * The hero's live layer: the black hole (loaded once the page is idle, so it never competes with the first paint),
 * the minute's signed bundle, and the live Window. Every time this browser verifies a signed bundle (on load, then every
 * minute) the disc flares, a shock ring leaves the hole and the bundle number stamps in: the signature as a heartbeat
 * (plan §0, beyond the references #3). The copy is server-rendered and passed in.
 */
const BlackHole = dynamic(() => import("./black-hole/black-hole"), { ssr: false });

const WIDE: BlackHoleView = VIEWS.wide;
const NARROW: BlackHoleView = VIEWS.narrow;
const WIDE_QUERY = "(min-width: 1024px)";
const IDLE_TIMEOUT_MS = 1500;
const MS = 1000;

/** Chips falling past the horizon: start and midway offsets from the hole, a turn, and a delay. */
type FallStyle = CSSProperties & Record<`--${string}`, string>;
const FALLS: ReadonlyArray<FallStyle> = [
  { "--sx": "-38vw", "--sy": "-30vh", "--mx": "-12vw", "--my": "-6vh", "--r": "40deg", animationDelay: "0s" },
  { "--sx": "-24vw", "--sy": "34vh", "--mx": "-6vw", "--my": "9vh", "--r": "-30deg", animationDelay: "-1.6s" },
  { "--sx": "26vw", "--sy": "-38vh", "--mx": "8vw", "--my": "-12vh", "--r": "55deg", animationDelay: "-3.1s" },
  { "--sx": "30vw", "--sy": "26vh", "--mx": "11vw", "--my": "5vh", "--r": "-45deg", animationDelay: "-4.7s" },
  { "--sx": "-44vw", "--sy": "4vh", "--mx": "-15vw", "--my": "-4vh", "--r": "25deg", animationDelay: "-6.2s" },
  { "--sx": "8vw", "--sy": "40vh", "--mx": "4vw", "--my": "12vh", "--r": "-60deg", animationDelay: "-7.6s" },
];

function subscribeWide(listener: () => void) {
  const query = matchMedia(WIDE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(() => setIdle(true), { timeout: IDLE_TIMEOUT_MS });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(() => setIdle(true), IDLE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, []);
  return idle;
}

export function HeroLive({ copy }: { copy: ReactNode }) {
  const data = useRealtime();
  const nowSec = Math.floor(useNow() / MS);
  const wide = useSyncExternalStore(
    subscribeWide,
    () => matchMedia(WIDE_QUERY).matches,
    () => false,
  );
  const idle = useIdle();
  const seq = data.status === "ready" ? data.bundle.seq : null;
  const [drop, setDrop] = useState<{ seq: number; at: number } | null>(null);
  useEffect(() => {
    if (seq !== null) setDrop({ seq, at: performance.now() });
  }, [seq]);

  const live =
    data.status === "ready" && nowSec > 0 ? LENGTHS.reduce((n, sec) => n + liveCount(sec, data.bundle, nowSec), 0) : 0;

  return (
    <section className="lp-hero" aria-labelledby="lp-h1">
      <div className="lp-hole">
        {idle ? <BlackHole view={wide ? WIDE : NARROW} flareAt={drop?.at ?? 0} className="lp-hole-gl" /> : null}
      </div>
      <div className="lp-grain" aria-hidden />
      {FALLS.map((style) => (
        <span key={String(style.animationDelay)} className="lp-fall" style={style} aria-hidden />
      ))}
      {drop ? <span key={drop.seq} className="lp-shock" aria-hidden /> : null}
      <div className="lp-hero-grid">
        <div className="lp-hero-copy">
          {copy}
          <p className="lp-beat" aria-live="polite">
            {data.status === "ready" && drop ? (
              <>
                <span key={drop.seq} className="lp-stamp">
                  <span className="lp-stamp-kanji" lang="ja" aria-hidden>
                    隠
                  </span>
                  {WORDS.hero.beat(data.bundle.seq, formatClock(data.bundle.publishedAt))}
                </span>
                <span>{WORDS.hero.live(live)}</span>
              </>
            ) : (
              <span>{WORDS.hero.waiting}</span>
            )}
          </p>
        </div>
        <HeroWindow />
      </div>
    </section>
  );
}
