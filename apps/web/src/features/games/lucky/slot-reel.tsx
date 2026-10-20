"use client";

import { animate, motion, useMotionValue } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { OVERSHOOT, REEL } from "./constants";

/**
 * One reel (Mitoshi `components/ui/slot-reel.tsx`, from 21st.dev adrielzimbril/handle-reel by way of Senryo): a
 * continuous strip that tumbles while the draw is made and, `stopAfterMs` after the target is known, settles with a
 * small overshoot, a thunk rather than a glide. `onTick` fires as rows pass the payline, `onLand` when it stops.
 * Reduced motion lands at once. The host announces the landing; the reel is hidden from assistive tech while it spins.
 * Once landed it holds the drawn row until the next spin (Mitoshi's reels tumbled again as soon as the deal showed).
 */
const HALF = 2;

function shuffled<T>(xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function SlotReel<T extends string | number>(p: {
  items: readonly T[];
  target: T | null;
  spinId: number;
  label: string;
  face: (item: T) => ReactNode;
  stopAfterMs: number;
  /** Tumbling while the draw is made; at rest otherwise, holding the landed row. */
  spinning: boolean;
  reduced: boolean;
  onTick?: () => void;
  onLand?: () => void;
  tone?: string | undefined;
}) {
  const y = useMotionValue(0);
  const probe = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState(0);
  const [landed, setLanded] = useState(false);
  const centre = Math.floor(REEL.rows / HALF);
  const first = p.items[0];

  const track = useMemo(() => {
    const pool = [...p.items];
    // At rest the reel is in order (the prerender and the first client render match); a spin reshuffles.
    const order = (xs: readonly T[]) => (p.spinId === 0 ? [...xs] : shuffled(xs));
    const lead = order(pool).slice(0, centre);
    const spins = Array.from({ length: REEL.cycles }, () => order(pool)).flat();
    return first === undefined ? [] : [...lead, p.target ?? first, ...spins];
  }, [p.spinId, p.target, p.items, centre, first]);

  useLayoutEffect(() => {
    const h = probe.current?.offsetHeight ?? 0;
    if (h && h !== row) setRow(h);
  }, [row]);

  const tick = useRef(p.onTick);
  tick.current = p.onTick;
  const land = useRef(p.onLand);
  land.current = p.onLand;
  useEffect(() => {
    if (!row) return;
    let last = Math.round(y.get() / row);
    let lastAt = 0;
    return y.on("change", (v) => {
      const i = Math.round(v / row);
      const now = performance.now();
      if (i !== last && now - lastAt >= REEL.tickGapMs) {
        lastAt = now;
        tick.current?.();
      }
      last = i;
    });
  }, [row, y]);

  const length = track.length;
  // `at` follows `row`; the spin restarts on spinId and target.
  useEffect(() => {
    if (!row) return;
    const at = (i: number) => (row * REEL.rows) / HALF - (i * row + row / HALF);
    if (p.spinId === 0) {
      y.set(at(centre));
      return;
    }
    setLanded(false);
    const tumble = () => {
      y.set(at(length - 1));
      return animate(y, [at(length - 1), at(centre + 1)], {
        duration: REEL.spinSec,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      });
    };
    if (p.target === null) {
      if (!p.spinning || p.reduced) {
        y.set(at(centre));
        return;
      }
      const loop = tumble();
      return () => loop.stop();
    }
    if (p.reduced) {
      y.set(at(centre));
      setLanded(true);
      land.current?.();
      return;
    }
    const loop = tumble();
    let settle: ReturnType<typeof animate> | undefined;
    const timer = setTimeout(() => {
      loop.stop();
      y.set(at(centre + 1));
      settle = animate(y, at(centre), {
        duration: REEL.settleSec,
        ease: OVERSHOOT,
        onComplete: () => {
          setLanded(true);
          land.current?.();
        },
      });
    }, p.stopAfterMs);
    return () => {
      clearTimeout(timer);
      loop.stop();
      settle?.stop();
    };
  }, [row, p.spinId, p.target, p.spinning, p.reduced]);

  const shown = landed && p.target !== null;
  return (
    <div className="slot" data-landed={shown ? "" : undefined} data-tone={p.tone} aria-hidden={!shown}>
      <span className="slot-label">{p.label}</span>
      <div className="slot-window" style={row ? { height: row * REEL.rows } : {}}>
        <div ref={probe} aria-hidden className="slot-row slot-probe">
          M
        </div>
        <motion.div style={{ y }} aria-hidden className="slot-strip">
          {track.map((item, i) => (
            <div key={i} className="slot-row" data-pay={shown && i === centre ? "" : undefined}>
              {p.face(item)}
            </div>
          ))}
        </motion.div>
        <span className="slot-payline" aria-hidden />
      </div>
    </div>
  );
}
