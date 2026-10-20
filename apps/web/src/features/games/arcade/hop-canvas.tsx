"use client";

// Candle Hop v3 on a canvas (R4-9, D-227; the input is Senryo's stage's — a press is a flap: a pointer anywhere, Space
// or ↑, on its edge, never held). The canyon letterboxes itself into the stage's whole box. State, trace and input live
// in refs the loop reads; React sees a throttled HUD and one end call. `autopilot` is the cabinets' attract loop.
import { ticksToMs } from "@kakure/arcade";
import { useCallback, useEffect, useRef, useState } from "react";
import { createHopRun, type HopCue, type HopRun } from "./hop/hop-run";
import { inkOf } from "./ink";
import { type ArcadeRun, localSeed, type RunEnd } from "./run";
import { type ArcadeView, type LoopDriver, useArcadeLoop, useArcadeSurface } from "./use-arcade-loop";

const HUD_EVERY_TICKS = 3;
const ATTRACT_RESTART_TICKS = 90;
const PRESS_KEYS = new Set([" ", "ArrowUp", "w", "W"]);

export function HopCanvas({
  run,
  paused = false,
  reduced,
  onHud,
  onEnd,
  onCue,
  autopilot = false,
}: {
  run: ArcadeRun | null;
  paused?: boolean;
  reduced: boolean;
  onHud: (score: number) => void;
  onEnd: (end: RunEnd) => void;
  onCue: (cue: HopCue) => void;
  autopilot?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef<{ active: ArcadeRun; hop: HopRun } | null>(null);
  const viewRef = useRef<ArcadeView | null>(null);
  const pendingRef = useRef<ArcadeRun | null>(null);
  const pressed = useRef(false);
  const overTicks = useRef(0);
  const [running, setRunning] = useState(false);
  const callbacks = useRef({ onHud, onEnd, onCue });
  callbacks.current = { onHud, onEnd, onCue };
  const autopilotRef = useRef(autopilot);
  autopilotRef.current = autopilot;

  const start = useCallback(
    (active: ArcadeRun, view: ArcadeView | null) => {
      if (!view) return;
      runRef.current = {
        active,
        hop: createHopRun({
          seed: active.seed,
          calm: active.calm,
          moves: active.moves ?? [],
          ink: inkOf(view.palette),
          still: reduced,
        }),
      };
    },
    [reduced],
  );
  const startRef = useRef(start);
  startRef.current = start;

  const driverRef = useRef<LoopDriver>({
    step() {
      const r = runRef.current;
      if (!r) return;
      const s = r.hop.s;
      const wasOver = s.over;
      if (autopilotRef.current && s.over && ++overTicks.current > ATTRACT_RESTART_TICKS && viewRef.current) {
        overTicks.current = 0;
        startRef.current({ ...r.active, seed: localSeed() }, viewRef.current);
        return;
      }
      const press = autopilotRef.current ? r.hop.autopilot() && !s.dying : pressed.current && !s.dying;
      pressed.current = false;
      r.hop.step(press, (c) => callbacks.current.onCue(c));
      if (s.tick % HUD_EVERY_TICKS === 0 || s.over) callbacks.current.onHud(s.score);
      if (s.over && !wasOver && !autopilotRef.current) {
        setRunning(false);
        const a = r.active;
        callbacks.current.onEnd({
          game: "candle-hop",
          seed: a.seed,
          calm: a.calm,
          score: s.score,
          ticks: s.tick,
          durationMs: ticksToMs(s.tick),
          trace: r.hop.trace,
        });
      }
    },
    draw(view: ArcadeView, alpha: number) {
      runRef.current?.hop.draw(view, alpha);
    },
  });

  const surface = useArcadeSurface(
    canvasRef,
    useCallback(
      (view: ArcadeView) => {
        viewRef.current = view;
        if (!runRef.current && pendingRef.current) start(pendingRef.current, view);
        driverRef.current.draw(view, 1, performance.now());
      },
      [start],
    ),
  );
  useArcadeLoop(driverRef, surface, running && !paused);

  // A new run: a fresh canyon on the run's seed and tape.
  useEffect(() => {
    if (!run) return;
    pendingRef.current = run;
    pressed.current = false;
    start(run, surface.current);
    setRunning(true);
    return () => {
      runRef.current = null;
    };
  }, [run, start, surface]);

  // Space / ↑ on the window while a run is live; a held key is one press.
  useEffect(() => {
    if (autopilot) return;
    const onKey = (e: KeyboardEvent) => {
      if (!PRESS_KEYS.has(e.key)) return;
      e.preventDefault();
      if (!e.repeat) pressed.current = true;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autopilot]);

  return (
    <canvas
      ref={canvasRef}
      className="ar-canvas"
      aria-hidden
      onPointerDown={(e) => {
        if (autopilot || (e.pointerType === "mouse" && e.button !== 0)) return;
        pressed.current = true;
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
