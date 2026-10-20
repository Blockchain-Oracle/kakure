"use client";

import type { ReactNode } from "react";
import { useNow } from "@/lib/time";
import { MS_PER_SEC, RING, RING_LENGTH, RING_URGENT, SEC_PER_HOUR, SEC_PER_MIN } from "./constants";
import "./kit.css";

/** "42s" · "4:05" · "2h": short enough for the inside of a 44 px ring. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / MS_PER_SEC));
  if (s >= SEC_PER_HOUR) return `${Math.floor(s / SEC_PER_HOUR)}h`;
  if (s >= SEC_PER_MIN) return `${Math.floor(s / SEC_PER_MIN)}:${String(s % SEC_PER_MIN).padStart(2, "0")}`;
  return `${s}s`;
}

/** The one ring face (Mitoshi `components/data/CountdownRing.tsx`): a draining arc, the accent while urgent. */
export function RingFace({
  fraction,
  urgent = false,
  children,
}: {
  fraction: number;
  urgent?: boolean;
  children?: ReactNode;
}) {
  const remaining = Math.min(1, Math.max(0, fraction)) * RING_LENGTH;
  return (
    <span className="gm-ring-face">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle
          cx={RING.centre}
          cy={RING.centre}
          r={RING.radius}
          pathLength={RING_LENGTH}
          strokeWidth={RING.stroke}
          className="gm-ring-track"
        />
        <circle
          cx={RING.centre}
          cy={RING.centre}
          r={RING.radius}
          pathLength={RING_LENGTH}
          strokeWidth={RING.stroke}
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH - remaining}
          className="gm-ring-arc"
          data-urgent={urgent || undefined}
        />
      </svg>
      <span className="gm-ring-inside">{children}</span>
    </span>
  );
}

/**
 * Time left between two moments as a draining ring with the time inside (Mitoshi `components/kit/CountdownRing.tsx`),
 * on the page's one-second clock. `role="timer"` is never live: a ticking figure isn't announced.
 */
export function CountdownRing({
  startMs,
  endMs,
  size = "md",
  glow = false,
  className,
}: {
  startMs: number;
  endMs: number;
  size?: "sm" | "md" | "lg";
  glow?: boolean;
  className?: string;
}) {
  const now = useNow();
  const span = Math.max(1, endMs - startMs);
  // The clock reads 0 while prerendering: a full ring then, never an empty one.
  const left = now === 0 ? span : Math.max(0, endMs - now);
  const fraction = Math.min(1, left / span);
  const text = formatLeft(left);
  const urgent = fraction < RING_URGENT;
  return (
    <span
      role="timer"
      aria-label={`${text} left`}
      data-size={size}
      data-glow={glow && urgent ? "" : undefined}
      className={`gm-ring${className ? ` ${className}` : ""}`}
    >
      <RingFace fraction={fraction} urgent={urgent}>
        <span aria-hidden className="gm-ring-left">
          {text}
        </span>
      </RingFace>
    </span>
  );
}
