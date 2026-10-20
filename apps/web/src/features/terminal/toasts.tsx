"use client";

import { cx } from "@kakure/ui-web";
import { CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { CONFETTI, TOAST_LIFETIME_MS, TOAST_MAX } from "./constants";

/**
 * The terminal's toasts (Owarine `terminal/toasts.tsx`, Tradash's system): top-centre, at most three, sliding in from
 * above; success 3.5 s, error 5 s, info 3.5 s, loading until replaced; a toast with the same id replaces the one shown
 * ("Buying Up…" becomes "Up BTC bought"); confetti bursts from both bottom corners on a win.
 */
export type ToastKind = "success" | "error" | "info" | "loading";

export interface TradeToast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  confetti?: boolean;
  action?: { label: string; run: () => void };
  persistent?: boolean;
}

let toasts: TradeToast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit(): void {
  for (const l of listeners) l();
}

export function dismissToast(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

/** Shows a toast; the same id replaces the one already shown. Returns the id. */
export function toast(t: Omit<TradeToast, "id"> & { id?: string }): string {
  seq += 1;
  const id = t.id ?? `t${seq}`;
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  const entry: TradeToast = { ...t, id };
  const exists = toasts.some((x) => x.id === id);
  toasts = exists ? toasts.map((x) => (x.id === id ? entry : x)) : [entry, ...toasts].slice(0, TOAST_MAX);
  if (t.kind !== "loading" && !t.persistent) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), TOAST_LIFETIME_MS[t.kind]),
    );
  }
  emit();
  return id;
}

const ICON = { success: CircleCheck, error: TriangleAlert, info: Info, loading: LoaderCircle } as const;
const TONE: Record<ToastKind, string> = {
  success: "text-up",
  error: "text-down",
  info: "text-muted-foreground",
  loading: "text-muted-foreground",
};

export function TradeToasts() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0rem)+0.75rem)] z-[9500] flex flex-col items-center gap-2 px-4"
    >
      {list.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            className="kk-toast pointer-events-auto relative w-full max-w-sm rounded-group border border-border bg-card px-4 py-3 text-foreground"
          >
            {t.confetti ? <Confetti /> : null}
            <div className="relative flex items-start gap-3">
              <Icon
                aria-hidden
                className={cx(
                  "mt-0.5 size-5 shrink-0",
                  TONE[t.kind],
                  t.kind === "loading" && "motion-safe:animate-spin",
                )}
                strokeWidth={2.25}
              />
              <div className="min-w-0 flex-1">
                <p className="text-row-strong">{t.title}</p>
                {t.description ? <p className="text-meta text-muted-foreground">{t.description}</p> : null}
              </div>
              {t.action ? (
                <button
                  type="button"
                  onClick={t.action.run}
                  className="h-8 shrink-0 self-center rounded-full bg-foreground px-3 text-chip-label text-stage"
                >
                  {t.action.label}
                </button>
              ) : null}
              {t.kind !== "loading" ? (
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismissToast(t.id)}
                  className="grid size-6 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X aria-hidden className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Two emitters near the bottom corners, gravity and drag, fading after half its life. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, CONFETTI.maxDpr);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const cs = getComputedStyle(canvas);
    const colours = ["--up", "--accent", "--leg-collect", "--leg-positions", "--on-fill"].map(
      (v) => cs.getPropertyValue(v).trim() || "currentColor",
    );
    const parts = CONFETTI.emitters.flatMap((fx) =>
      Array.from({ length: CONFETTI.perEmitter }, () => {
        const speed = CONFETTI.speedMin + Math.random() * CONFETTI.speedSpread;
        const lean = fx < CONFETTI.fadeFrom ? -CONFETTI.angleLean : CONFETTI.angleLean;
        const angle = -Math.PI / 2 + (Math.random() - CONFETTI.fadeFrom) * CONFETTI.angleSpread + lean;
        return {
          x: rect.width * fx,
          y: rect.height * CONFETTI.startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          w: CONFETTI.sizeMinW + Math.random() * CONFETTI.sizeSpreadW,
          h: CONFETTI.sizeMinH + Math.random() * CONFETTI.sizeSpreadH,
          r: Math.random() * Math.PI,
          vr: (Math.random() - CONFETTI.fadeFrom) * CONFETTI.spin,
          drag: CONFETTI.dragMin + Math.random() * CONFETTI.dragSpread,
          c: colours[Math.floor(Math.random() * colours.length)] ?? "currentColor",
        };
      }),
    );
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - start) / CONFETTI.durationMs;
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (t >= 1) return;
      ctx.globalAlpha = t < CONFETTI.fadeFrom ? 1 : 1 - (t - CONFETTI.fadeFrom) / CONFETTI.fadeFrom;
      for (const p of parts) {
        p.vy += CONFETTI.gravity;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-32 h-[calc(100%+8rem)] w-full"
    />
  );
}
