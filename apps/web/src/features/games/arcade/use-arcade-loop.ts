"use client";

import { FIELD_H, FIELD_W, STEP_MS } from "@kakure/arcade";
import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";
import { type ArcadePalette, readPalette } from "./palette";

/**
 * The canvas as a surface, and the loop that drives a simulation over it.
 *
 * The simulation is stepped at exactly 60 Hz whatever the display does: a frame's elapsed time goes
 * into an accumulator and the engine steps while there is a whole step in it, then the draw is handed
 * the fraction left over so it can interpolate between the last two states. A 120 Hz screen draws
 * twice per step and sees smooth motion; a 30 Hz one steps twice per draw and sees the same run. A
 * stall — a tab switch, a long task — is clamped to a tenth of a second so the sim never lurches, and
 * the loop is stopped altogether while the document is hidden, then restarted with a fresh clock.
 *
 * The surface owns the device-pixel ratio: the canvas's backing store is sized to the element's box
 * times the ratio (capped at two, past which nothing is sharper and a phone pays for it), and the draw
 * receives a transform that maps the fixed 640×360 field onto it, so every draw call is in field
 * units and nothing else knows how big the screen is.
 */
export interface ArcadeView {
  ctx: CanvasRenderingContext2D;
  /** The element's box in CSS pixels. */
  w: number;
  h: number;
  dpr: number;
  /** CSS pixels per field unit. */
  scale: number;
  palette: ArcadePalette;
}

export interface LoopDriver {
  /** One fixed step. */
  step(): void;
  /** Paint the current state, interpolated `alpha` (0..1) of the way to the next. */
  draw(view: ArcadeView, alpha: number, nowMs: number): void;
}

const MAX_FRAME_MS = 100;
const MAX_DPR = 2;

/** Whether the page is on screen; the loop stops while it isn't and restarts with a fresh clock. */
function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    () => !document.hidden,
    () => true,
  );
}

/** Applies the field-to-device transform; called before every draw so a draw can never forget it. */
export function applyFieldTransform(view: ArcadeView): void {
  const s = view.scale * view.dpr;
  view.ctx.setTransform(s, 0, 0, s, 0, 0);
}

/**
 * Measures the canvas on mount and on every resize, keeps the backing store at device resolution, and
 * re-reads the palette. `onReady` runs after each measure so an idle screen can repaint itself.
 */
export function useArcadeSurface(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onReady: (view: ArcadeView) => void,
): RefObject<ArcadeView | null> {
  const viewRef = useRef<ArcadeView | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const scale = Math.min(rect.width / FIELD_W, rect.height / FIELD_H);
      const view: ArcadeView = { ctx, w: rect.width, h: rect.height, dpr, scale, palette: readPalette(canvas) };
      viewRef.current = view;
      readyRef.current(view);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);

  return viewRef;
}

/** Runs the driver while `running` and the document is visible. */
export function useArcadeLoop(
  driverRef: RefObject<LoopDriver>,
  viewRef: RefObject<ArcadeView | null>,
  running: boolean,
): void {
  const visible = useDocumentVisible();

  useEffect(() => {
    if (!running || !visible) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      const view = viewRef.current;
      const driver = driverRef.current;
      const elapsed = Math.min(MAX_FRAME_MS, now - last);
      last = now;
      acc += elapsed;
      while (acc >= STEP_MS) {
        driver.step();
        acc -= STEP_MS;
      }
      if (view) driver.draw(view, acc / STEP_MS, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, visible, driverRef, viewRef]);
}
