import type { ReactNode } from "react";
import { encode } from "uqr";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev tom_ui/qr-code (#12248): rounded finder patterns and dot-style modules, drawn as one SVG
 * path. Kawase's DottedQr rules (kawase.md §8.3): dots at 0.5 of a module (the radius that decoded), finders as
 * rounded rings, always black on the light `paper` plate so it scans in every theme. Error correction is a prop:
 * the bet QR uses M with no centre mark (plan §7); receipt QRs may carry a mark, with the modules under it cleared.
 * The matrix comes from `uqr` (MIT) instead of `qrcode`, and the value never goes into an attribute.
 */
export interface DottedQrProps {
  value: string;
  ecc?: "L" | "M" | "Q" | "H";
  /** Rendered width in px (the SVG scales). */
  size?: number;
  /** Plain square modules: the fallback for cameras that struggle with dots. */
  square?: boolean;
  /** A centre mark (receipts only); 22 % of the code, the modules under it are cleared. */
  mark?: ReactNode;
  /** Accessible name; never the encoded value (a bet link is a bearer secret). */
  label: string;
  className?: string;
}

const FINDER = 7;
const DOT_RADIUS = 0.5;
const MARK_FRACTION = 0.22;
const FINDER_OUTER_RADIUS = 2;
const FINDER_INNER_RADIUS = 1;
const FINDER_RING = 1;
const FINDER_CORE_OFFSET = 2;
const FINDER_CORE = 3;
const HALF = 2;
const PERCENT = 100;

function inFinder(x: number, y: number, n: number): boolean {
  return (x < FINDER && y < FINDER) || (x >= n - FINDER && y < FINDER) || (x < FINDER && y >= n - FINDER);
}

export function DottedQr({ value, ecc = "M", size = 256, square = false, mark, label, className }: DottedQrProps) {
  const qr = encode(value, { ecc, border: 0 });
  const n = qr.size;
  const markSize = mark ? Math.ceil(n * MARK_FRACTION) : 0;
  const markStart = (n - markSize) / HALF;
  const inMark = (x: number, y: number) =>
    mark !== undefined &&
    x >= markStart - 1 &&
    x < markStart + markSize + 1 &&
    y >= markStart - 1 &&
    y < markStart + markSize + 1;

  let path = "";
  for (let y = 0; y < n; y += 1) {
    const row = qr.data[y] ?? [];
    for (let x = 0; x < n; x += 1) {
      if (!row[x] || inFinder(x, y, n) || inMark(x, y)) continue;
      path += square
        ? `M${x} ${y}h1v1h-1z`
        : `M${x} ${y + DOT_RADIUS}a${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${DOT_RADIUS * HALF} 0a${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${-DOT_RADIUS * HALF} 0`;
    }
  }
  const finders = [
    [0, 0],
    [n - FINDER, 0],
    [0, n - FINDER],
  ] as const;

  return (
    <div className={cx("relative inline-block", className)} style={{ width: size, height: size }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} className="block">
        <path d={path} fill="var(--paper-ink)" />
        {finders.map(([fx, fy]) => (
          <g key={`${fx}-${fy}`} fill="none">
            <rect
              x={fx + FINDER_RING / HALF}
              y={fy + FINDER_RING / HALF}
              width={FINDER - FINDER_RING}
              height={FINDER - FINDER_RING}
              rx={square ? 0 : FINDER_OUTER_RADIUS}
              stroke="var(--paper-ink)"
              strokeWidth={FINDER_RING}
            />
            <rect
              x={fx + FINDER_CORE_OFFSET}
              y={fy + FINDER_CORE_OFFSET}
              width={FINDER_CORE}
              height={FINDER_CORE}
              rx={square ? 0 : FINDER_INNER_RADIUS}
              fill="var(--paper-ink)"
            />
          </g>
        ))}
      </svg>
      {mark ? (
        <span
          aria-hidden
          className="absolute inset-0 m-auto grid place-items-center"
          style={{ width: `${MARK_FRACTION * PERCENT}%`, height: `${MARK_FRACTION * PERCENT}%` }}
        >
          {mark}
        </span>
      ) : null}
    </div>
  );
}
