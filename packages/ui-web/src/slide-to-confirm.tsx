"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev reuno-ui/slide-button (#3124): drag the knob across; past 90 % it commits,
 * otherwise it springs back. Reskin: Kawase's 56 px plate with corner 28, a black knob, the accent fill behind it
 * (a consequential action), no inset shadows or drop shadow; the motion library is replaced by pointer events and
 * the `sheet-release` CSS spring. Keyboard: it is a slider — arrows move it, End commits.
 */
export interface SlideToConfirmProps {
  label: string;
  /** Read by assistive tech after the label, e.g. "Switches to mainnet". */
  hint?: string;
  onConfirm: () => void;
  className?: string;
}

const COMMIT_AT = 0.9;
const KEY_STEP = 0.1;
const PERCENT = 100;
const KNOB_INSET = 4;
/** The label is gone by the time the knob is two thirds across. */
const LABEL_FADE = 1.5;

export function SlideToConfirm({ label, hint, onConfirm, className }: SlideToConfirmProps) {
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const start = useRef<{ pointerX: number; progress: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const [travel, setTravel] = useState(1);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () =>
      setTravel(Math.max(1, element.clientWidth - (knob.current?.offsetWidth ?? 0) - KNOB_INSET * 2));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (done) onConfirm();
  }, [done, onConfirm]);

  const settle = (value: number) => {
    if (value >= COMMIT_AT) {
      setProgress(1);
      setDone(true);
    } else {
      setProgress(0);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (done) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { pointerX: event.clientX, progress };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = start.current.progress + (event.clientX - start.current.pointerX) / travel;
    setProgress(Math.min(1, Math.max(0, next)));
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    settle(progress);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (done) return;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(1, progress + KEY_STEP);
      if (next >= 1) settle(1);
      else setProgress(next);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "Home") {
      event.preventDefault();
      setProgress(0);
    } else if (event.key === "End") {
      event.preventDefault();
      settle(1);
    }
  };

  const spring = dragging
    ? "transition-none"
    : "duration-(--spring-sheet-release-duration) ease-(--spring-sheet-release) motion-reduce:transition-none";
  const offset = progress * travel;

  return (
    <div
      ref={track}
      className={cx("relative h-14 w-full select-none overflow-hidden rounded-button bg-secondary", className)}
    >
      <div
        aria-hidden
        className={cx("absolute inset-y-0 left-0 rounded-button bg-accent transition-[width]", spring)}
        style={{
          // Hidden at rest so it doesn't read as a ring around the knob; it grows from the knob as you slide.
          width: progress > 0 ? `calc(${offset}px + var(--size-button-secondary-height) + ${KNOB_INSET * 2}px)` : 0,
        }}
      />
      <span
        className={cx(
          "pointer-events-none absolute inset-0 flex items-center justify-center pl-12 text-button-label",
          done ? "text-accent-foreground" : "text-secondary-foreground",
        )}
        style={{ opacity: done ? 1 : Math.max(0, 1 - progress * LABEL_FADE) }}
      >
        {done ? "Switching…" : label}
      </span>
      <div
        ref={knob}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-description={hint}
        aria-valuemin={0}
        aria-valuemax={PERCENT}
        aria-valuenow={Math.round(progress * PERCENT)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cx(
          "absolute top-1 left-1 grid size-12 touch-none place-items-center rounded-full bg-primary text-primary-foreground shadow-button outline-none transition-transform",
          spring,
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          done ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
        style={{ transform: `translateX(${offset}px)` }}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          {done ? (
            <path d="M5 12.5 10 17 19 7" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </div>
    </div>
  );
}
