"use client";

import { useEffect, useRef } from "react";
import { cx } from "./cx";

/**
 * Sealed figures that decrypt (plan §0, beyond the references #2), after 21st.dev manuarora700/encrypted-text
 * (#18575): unrevealed characters flip through a glyph set and the real ones land left to right. Rewritten without
 * `motion`: one rAF loop writes `textContent` directly, so nothing re-renders per frame. With `text` null the glyphs
 * keep flipping slowly (a sealed pool); when `text` arrives they decrypt into it. Reduced motion (system or in-app)
 * shows the value, or `sealed`, at once. The accessible name is always the plain value.
 */
const GLYPHS = "0123456789abcdef#%×";
const REVEAL_MS = 45;
const FLIP_MS = 60;
const SEALED_FLIP_MS = 140;

function scramble(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
  return out;
}

function reduced(): boolean {
  return document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function DecryptText({
  text,
  sealed = "sealed",
  length = 5,
  className,
}: {
  /** The value to show; null while it is sealed. */
  text: string | null;
  /** The accessible (and reduced-motion) word while sealed. */
  sealed?: string;
  /** How many glyphs a sealed value shows. */
  length?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced()) {
      node.textContent = text ?? sealed;
      return;
    }
    let raf = 0;
    let lastFlip = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (text === null) {
        if (now - lastFlip < SEALED_FLIP_MS) return;
        node.textContent = scramble(length);
        lastFlip = now;
        return;
      }
      const shown = Math.min(text.length, Math.floor((now - start) / REVEAL_MS));
      if (shown >= text.length) {
        node.textContent = text;
        cancelAnimationFrame(raf);
        return;
      }
      if (now - lastFlip < FLIP_MS) return;
      node.textContent = text.slice(0, shown) + scramble(text.length - shown);
      lastFlip = now;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, sealed, length]);

  return (
    <span className={cx("tabular-nums", className)} role="img" aria-label={text ?? sealed}>
      <span ref={ref} aria-hidden>
        {text ?? sealed}
      </span>
    </span>
  );
}
