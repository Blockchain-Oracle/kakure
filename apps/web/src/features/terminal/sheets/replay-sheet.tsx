"use client";

import { fire } from "@kakure/sounds";
import { cx, RollingNumber, Sheet } from "@kakure/ui-web";
import { Pause, Play, RotateCcw, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HALF_PIXEL, PERCENT, REPLAY_DASH } from "../constants";
import { clockText, livePnlText, sideWord } from "../format";
import { coverage, type Episode } from "../replay";

/**
 * Replay (Owarine `ui/sheets/ReplaySheet.tsx`, Tradash's `lo`): the recorded path played back with the PnL the screen
 * showed, a scrubber, how much of the trade was recorded, and Share. A replay plays in at most 12 s, whatever the trade
 * lasted; the realized result shows once it ends.
 */
const PLAY_MS = 12_000;
const SCRUB_STEPS = 1000;
const MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 3_600;
const PAD_FRACTION = 0.15;
const MIN_PAD_FRACTION = 0.0001;
const INSET_X = 4;
const INSET_Y = 8;
const HEAD_RADIUS = 4;
const LEVEL_ALPHA = 0.6;
const LINE_WIDTH = 2;
const MAX_DPR = 2;
const tap = () => fire("toggle", { haptic: "tick" });

function duration(ms: number): string {
  const s = Math.max(0, ms / MS);
  if (s < MINUTE_S) return `${Math.round(s)}s`;
  if (s < HOUR_S) return `${Math.round(s / MINUTE_S)}m`;
  return `${(s / HOUR_S).toFixed(1)}h`;
}

/** The PnL at time `t`: the last recorded one at or before it (back-filled samples carry none). */
function pnlAt(samples: Episode["samples"], t: number): number {
  let out = 0;
  for (const [ts, , pnl] of samples) {
    if (ts > t) break;
    if (pnl !== null) out = pnl;
  }
  return out;
}

function draw(canvas: HTMLCanvasElement, e: Episode, upTo: number): void {
  const ctx = canvas.getContext("2d");
  const s = e.samples;
  const t0 = s[0]?.[0];
  const t1 = s.at(-1)?.[0];
  if (!ctx || t0 === undefined || t1 === undefined) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(canvas);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const prices = [...s.map((x) => x[1]), ...(e.entrySpot ? [e.entrySpot] : []), ...(e.line ? [e.line] : [])];
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * PAD_FRACTION, hi * MIN_PAD_FRACTION);
  lo -= pad;
  hi += pad;
  const w = rect.width;
  const h = rect.height;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (w - INSET_X * 2) + INSET_X;
  const y = (p: number) => h - INSET_Y - ((p - lo) / (hi - lo)) * (h - INSET_Y * 2);
  ctx.clearRect(0, 0, w, h);
  const level = (price: number | null, colour: string, dash: number[]) => {
    if (!price) return;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.globalAlpha = LEVEL_ALPHA;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y(price)) + HALF_PIXEL);
    ctx.lineTo(w, Math.round(y(price)) + HALF_PIXEL);
    ctx.stroke();
    ctx.restore();
  };
  level(e.entrySpot, v("--foreground"), [...REPLAY_DASH.entry]);
  level(e.line, v("--down"), [...REPLAY_DASH.line]);
  const tone = pnlAt(s, upTo) >= 0 ? v("--up") : v("--down");
  ctx.strokeStyle = tone;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let last: [number, number] | null = null;
  for (const [t, p] of s) {
    if (t > upTo) break;
    if (!last) ctx.moveTo(x(t), y(p));
    else ctx.lineTo(x(t), y(p));
    last = [x(t), y(p)];
  }
  ctx.stroke();
  if (last) {
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(last[0], last[1], HEAD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function ReplaySheet({
  open,
  onClose,
  episode,
  finalPnl,
  coin,
  onShare,
}: {
  open: boolean;
  onClose: () => void;
  episode: Episode | null;
  /** The realized result in ZEC, shown once the replay ends. */
  finalPnl: number | null;
  coin: string;
  onShare: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  // Starts from the beginning each time it opens on an episode.
  useEffect(() => {
    if (open) {
      setProgress(0);
      setPlaying(true);
    }
  }, [open, episode?.key]);

  const s = episode?.samples ?? [];
  const t0 = s[0]?.[0] ?? 0;
  const t1 = s.at(-1)?.[0] ?? 0;
  const upTo = t0 + (t1 - t0) * progress;

  useEffect(() => {
    if (!playing || !episode) return;
    const span = Math.min(PLAY_MS, t1 - t0);
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      setProgress((p) => {
        const next = Math.min(1, p + dt / Math.max(1, span));
        if (next >= 1) setPlaying(false);
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, episode, t0, t1]);

  useEffect(() => {
    if (canvas.current && episode && episode.samples.length > 1) draw(canvas.current, episode, upTo);
  }, [episode, upTo]);

  if (!episode) return null;
  const realized = progress >= 1 && finalPnl !== null;
  const pnl = realized ? finalPnl : pnlAt(s, upTo);
  return (
    <Sheet open={open} onClose={onClose} title={`${sideWord(episode.side)} ${episode.asset}`}>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-meta text-muted-foreground">{realized ? "Realized" : "Unrealized"}</p>
          <p className={cx("numbers font-display text-title", pnl >= 0 ? "text-up" : "text-down")}>
            <RollingNumber value={`${livePnlText(pnl)} ${coin}`} />
          </p>
        </div>
        <canvas
          ref={canvas}
          className="h-60 w-full rounded-group bg-secondary/50"
          role="img"
          aria-label="Replay of the trade's price path"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={playing ? "Pause" : progress >= 1 ? "Replay" : "Play"}
            onClick={() => {
              tap();
              if (progress >= 1) setProgress(0);
              setPlaying((p) => !p || progress >= 1);
            }}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground text-stage"
          >
            {playing ? (
              <Pause aria-hidden className="size-5" />
            ) : progress >= 1 ? (
              <RotateCcw aria-hidden className="size-5" />
            ) : (
              <Play aria-hidden className="size-5" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={SCRUB_STEPS}
            value={Math.round(progress * SCRUB_STEPS)}
            onChange={(e) => {
              setPlaying(false);
              setProgress(Number(e.target.value) / SCRUB_STEPS);
            }}
            className="w-full accent-[var(--primary)]"
            aria-label="Scrub the replay"
          />
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-meta text-muted-foreground">
          <span>{duration(t1 - t0)}</span>
          <span>{Math.round(coverage(episode) * PERCENT)}% recorded</span>
          {episode.closedAtMs ? <span>Closed {clockText(Math.floor(episode.closedAtMs / MS))}</span> : null}
        </div>
        <button
          type="button"
          onClick={() => {
            tap();
            onShare();
          }}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-secondary font-bold text-foreground"
        >
          <Share2 aria-hidden className="size-4" /> Share
        </button>
      </div>
    </Sheet>
  );
}
