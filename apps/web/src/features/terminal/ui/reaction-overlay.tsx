"use client";

import { CALLOUT_LIFETIME_MS, type CalloutTone } from "@kakure/sounds";
import { cx } from "@kakure/ui-web";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FrameInfo } from "../chart/live-chart";

/**
 * The reactions overlay (Owarine `ui/ReactionOverlay.tsx`, Tradash's `aX`): an inset edge glow for 0.9 s on a surge
 * (up colour) or a slump (down colour), and emoji callouts riding the price head, at most two, each living by its tone
 * (good/bad 1.5 s, great 1.8 s, epic 2.2 s, warn 2.6 s), springing in and lifting out. CSS keyframes in
 * `terminal.css`; reduced motion fades.
 */
export interface ReactionOverlayHandle {
  callout(tone: CalloutTone, emoji: string, text: string): void;
  flash(favorable: boolean, mega: boolean): void;
  /** Called every chart frame: the callout stack follows the line's head. */
  frame(info: FrameInfo | null): void;
}

interface Shown {
  id: number;
  tone: CalloutTone;
  emoji: string;
  text: string;
  leaving: boolean;
}

const MAX_SHOWN = 2;
const FLASH_MS = 900;
/** The lift-out plays over a callout's last 220 ms. */
const OUT_MS = 220;

export function ReactionOverlay({ handle }: { handle: Ref<ReactionOverlayHandle> }) {
  const head = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown[]>([]);
  const [flash, setFlash] = useState<{ id: number; favorable: boolean; mega: boolean } | null>(null);
  const seq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = (run: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  };

  useImperativeHandle(handle, () => ({
    callout(tone, emoji, text) {
      seq.current += 1;
      const id = seq.current;
      const life = CALLOUT_LIFETIME_MS[tone];
      setShown((s) => [...s, { id, tone, emoji, text, leaving: false }].slice(-MAX_SHOWN));
      later(() => setShown((s) => s.map((x) => (x.id === id ? { ...x, leaving: true } : x))), life - OUT_MS);
      later(() => setShown((s) => s.filter((x) => x.id !== id)), life);
    },
    flash(favorable, mega) {
      seq.current += 1;
      const id = seq.current;
      setFlash({ id, favorable, mega });
      later(() => setFlash((f) => (f?.id === id ? null : f)), FLASH_MS);
    },
    frame(info) {
      const el = head.current;
      if (el && info) el.style.transform = `translate3d(${info.headX}px, ${info.headY}px, 0)`;
    },
  }));

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
      {flash ? (
        <div
          key={flash.id}
          className={cx(
            "kk-flash absolute inset-0",
            flash.favorable ? "kk-flash-up" : "kk-flash-down",
            flash.mega && "is-mega",
          )}
        />
      ) : null}
      <div ref={head} className="absolute top-0 left-0 will-change-transform">
        <div className="absolute right-3 bottom-5 flex flex-col items-end gap-1">
          {shown.map((c) => (
            <div
              key={c.id}
              data-tone={c.tone}
              className={cx("kk-callout whitespace-nowrap", c.leaving ? "kk-callout-out" : "kk-callout-in")}
            >
              <span className="mr-1 not-italic">{c.emoji}</span>
              {c.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
