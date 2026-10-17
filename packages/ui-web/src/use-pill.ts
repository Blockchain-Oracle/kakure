"use client";

import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from "react";

/** Spring transitions as static class names, so Tailwind sees them; `motion-reduce` stops them. */
const SPRING_CLASS = {
  "rail-pill":
    "transition-[transform,width,height] duration-(--spring-rail-pill-duration) ease-(--spring-rail-pill) motion-reduce:transition-none",
  "dock-bubble":
    "transition-[transform,width,height] duration-(--spring-dock-bubble-duration) ease-(--spring-dock-bubble) motion-reduce:transition-none",
} as const;

export type PillSpring = keyof typeof SPRING_CLASS;

export interface PillPlacement {
  style: CSSProperties;
  /** The spring transition, absent for the first placement and for resizes (they snap). */
  className: string;
}

/**
 * One highlight that travels to the measured active item, "so a change reads as one object travelling,
 * not a swap" (Kawase Rail, kawase.md §5). The first placement snaps; later moves run on a CSS spring
 * (`--spring-*` from @kakure/tokens, as Tailwind classes), and `motion-reduce` turns the transition off.
 *
 * Items mark themselves with `data-pill-key`; the container is the positioning parent.
 */
export function useMeasuredPill(
  container: RefObject<HTMLElement | null>,
  activeKey: string | null,
  spring: PillSpring,
): PillPlacement | null {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; animate: boolean } | null>(null);
  // Corrections while the page hydrates (e.g. the stored tab replacing the default) snap; only later moves travel.
  const settled = useRef(false);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root || activeKey === null) {
      setBox(null);
      return;
    }
    const measure = (animate: boolean) => {
      const item = root.querySelector<HTMLElement>(`[data-pill-key="${CSS.escape(activeKey)}"]`);
      if (!item) {
        setBox(null);
        return;
      }
      const next = { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight };
      setBox((previous) => {
        const same =
          previous !== null &&
          previous.x === next.x &&
          previous.y === next.y &&
          previous.w === next.w &&
          previous.h === next.h;
        // A resize that changes nothing (ResizeObserver's first call) must not cancel a running move.
        if (same && !animate) {
          return previous;
        }
        return { ...next, animate: animate && previous !== null };
      });
    };
    measure(settled.current);
    const frame = requestAnimationFrame(() => {
      settled.current = true;
    });
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, activeKey]);

  if (!box) {
    return null;
  }
  return {
    style: { width: box.w, height: box.h, transform: `translate3d(${box.x}px, ${box.y}px, 0)` },
    className: box.animate ? SPRING_CLASS[spring] : "",
  };
}
