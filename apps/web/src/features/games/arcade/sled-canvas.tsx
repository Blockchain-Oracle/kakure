"use client";

// Line Rider v3 on a canvas (R4-9, D-227; the input and loop are Senryo:apps/web/src/features/games/arcade/
// ArcadeStage.tsx's): hold anywhere — a pointer, Space or ↑ — to press into the line, let go to hop; lean with the
// screen's halves or ← →. The sled fills the whole screen (its own camera), so the canvas is the stage's full box.
// The state, the trace and the input live in refs the loop reads; React sees a throttled HUD and one end call.
import { SLED, sledScoreOf, ticksToMs } from "@kakure/arcade";
import { useCallback, useEffect, useRef, useState } from "react";
import { inkOf } from "./ink";
import { type ArcadeRun, localSeed, type RunEnd } from "./run";
import { drawSled } from "./sled/sled-draw";
import { createSledRun, type SledCue, type SledInput, type SledRun } from "./sled/sled-scene";
import { type ArcadeView, type LoopDriver, useArcadeLoop, useArcadeSurface } from "./use-arcade-loop";

export interface SledHud {
  score: number;
  combo: number;
  /** The hop's charge while pressing into the line, 0..1. */
  charge: number;
}

const HUD_EVERY_TICKS = 3;
const ATTRACT_RESTART_TICKS = 90;
const HOLD_KEYS = new Set([" ", "ArrowUp", "w", "W"]);
const BACK_KEYS = new Set(["ArrowLeft", "a", "A"]);
const FORWARD_KEYS = new Set(["ArrowRight", "d", "D"]);

export function SledCanvas({
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
  onHud: (hud: SledHud) => void;
  onEnd: (end: RunEnd) => void;
  onCue: (cue: SledCue) => void /** The attract loop: the sled plays itself and nothing is recorded or ended. */;
  autopilot?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef<{ active: ArcadeRun; sled: SledRun } | null>(null);
  const viewRef = useRef<ArcadeView | null>(null);
  const pointers = useRef(new Map<number, -1 | 1>());
  const keys = useRef<{ hold: boolean; lean: -1 | 0 | 1 }>({ hold: false, lean: 0 });
  const [running, setRunning] = useState(false);
  const callbacks = useRef({ onHud, onEnd, onCue });
  callbacks.current = { onHud, onEnd, onCue };
  const autopilotRef = useRef(autopilot);
  autopilotRef.current = autopilot;
  const pendingRef = useRef<ArcadeRun | null>(null);
  const overTicks = useRef(0);

  const input = (): SledInput => {
    const sides = [...pointers.current.values()];
    return {
      hold: keys.current.hold || sides.length > 0,
      lean: keys.current.lean !== 0 ? keys.current.lean : (sides.at(-1) ?? 0),
    };
  };

  const driverRef = useRef<LoopDriver>({
    step() {
      const r = runRef.current;
      if (!r) return;
      const s = r.sled.scene.s;
      const wasOver = s.over;
      // The attract loop starts a fresh sled a beat after each wipeout.
      if (autopilotRef.current && s.over && ++overTicks.current > ATTRACT_RESTART_TICKS && viewRef.current) {
        overTicks.current = 0;
        startRef.current({ ...r.active, seed: localSeed() }, viewRef.current);
        return;
      }
      r.sled.step(autopilotRef.current ? r.sled.autopilot() : input(), (c) => callbacks.current.onCue(c));
      if (s.tick % HUD_EVERY_TICKS === 0 || s.over)
        callbacks.current.onHud({
          score: sledScoreOf(s),
          combo: s.combo,
          charge: s.grounded && s.held ? Math.min(1, s.heldTicks / SLED.hopChargeTicks) : 0,
        });
      if (s.over && !wasOver && !autopilotRef.current) {
        setRunning(false);
        const a = r.active;
        callbacks.current.onEnd({
          game: "line-rider",
          seed: a.seed,
          calm: a.calm,
          score: sledScoreOf(s),
          ticks: s.tick,
          durationMs: ticksToMs(s.tick),
          trace: r.sled.trace,
        });
      }
    },
    draw(view: ArcadeView, alpha: number, nowMs: number) {
      const r = runRef.current;
      if (r) drawSled(view, r.sled.scene, alpha, nowMs);
    },
  });
  const start = useCallback(
    (active: ArcadeRun, view: ArcadeView | null) => {
      if (!view) return;
      const tape = active.tapeMeta ?? { feed: "", fromSec: 0, toSec: 0, moves: [] };
      runRef.current = {
        active,
        sled: createSledRun({
          seed: active.seed,
          calm: active.calm,
          tape: { ...tape, moves: active.moves ?? [] },
          ink: inkOf(view.palette),
          still: reduced,
        }),
      };
    },
    [reduced],
  );
  const startRef = useRef(start);
  startRef.current = start;

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

  // A new run: a fresh sled on the run's seed and tape; the inputs cleared.
  useEffect(() => {
    if (!run) return;
    pendingRef.current = run;
    pointers.current.clear();
    keys.current = { hold: false, lean: 0 };
    start(run, surface.current);
    setRunning(true);
    return () => {
      runRef.current = null;
    };
  }, [run, start, surface]);

  // Keys on the window while a run is live (nothing has to be focused); the ones the game uses don't scroll the page.
  useEffect(() => {
    if (autopilot) return;
    const onKey = (e: KeyboardEvent) => {
      const down = e.type === "keydown";
      if (HOLD_KEYS.has(e.key)) keys.current.hold = down;
      else if (BACK_KEYS.has(e.key)) keys.current.lean = down ? -1 : 0;
      else if (FORWARD_KEYS.has(e.key)) keys.current.lean = down ? 1 : 0;
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [autopilot]);

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>, down: boolean) => {
    if (autopilot) return;
    if (down) {
      const box = e.currentTarget.getBoundingClientRect();
      pointers.current.set(e.pointerId, e.clientX - box.left < box.width / 2 ? -1 : 1);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else pointers.current.delete(e.pointerId);
  };

  return (
    <canvas
      ref={canvasRef}
      className="ar-canvas"
      aria-hidden
      onPointerDown={(e) => onPointer(e, true)}
      onPointerUp={(e) => onPointer(e, false)}
      onPointerCancel={(e) => onPointer(e, false)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
