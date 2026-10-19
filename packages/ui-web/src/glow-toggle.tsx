"use client";

import type { MouseEvent, ReactNode, Ref } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev daiwiikharihar/cinematic-glow-toggle (#9705), installed with `21st add` on 2026-10-19 and
 * reskinned to Mitoshi's tokens: the labelled switch, the inset track, the thumb with its gloss highlight, the
 * thumb's spring (stiffness 500, damping 30, as the `glow-thumb` CSS spring) and the glowing ON label. Changed: the
 * emerald glow is vermilion `--glow` (the app's one sanctioned glow); framer-motion is replaced by CSS transitions
 * (`.kk-glow-*` in kit.css), so no motion runtime ships; it is a native `role="switch"` button. Visual state reads
 * `--on` (0 or 1), which `aria-checked` sets here and an app may set from its own state in CSS before hydration.
 */
export interface GlowToggleProps {
  checked: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  /** The accessible name, including what a press does. */
  label: string;
  offLabel?: ReactNode;
  onLabel?: ReactNode;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function GlowToggle({ checked, onToggle, label, offLabel, onLabel, className, ref }: GlowToggleProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cx("kk-glow-toggle", className)}
    >
      {offLabel ? (
        <span aria-hidden className="kk-glow-label" data-side="off">
          {offLabel}
        </span>
      ) : null}
      <span aria-hidden className="kk-glow-track">
        <span className="kk-glow-thumb">
          <span className="kk-glow-gloss" />
        </span>
      </span>
      {onLabel ? (
        <span aria-hidden className="kk-glow-label" data-side="on">
          {onLabel}
        </span>
      ) : null}
    </button>
  );
}
