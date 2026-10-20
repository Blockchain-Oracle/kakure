import { useId } from "react";
import { DECIMAL, MARBLE, MARBLE_HASH_MULT, MARBLE_SHAPE_A, MARBLE_SHAPE_B } from "./constants";

/**
 * A blurred marble of the brand's inks, seeded by a nickname (Mitoshi `AccountAvatar.tsx`, after boring-avatars'
 * "marble", MIT), so one player wears the same marble on every board. Decorative: the nickname sits beside it.
 */
const PALETTE = ["var(--vermilion)", "var(--up)", "var(--warn-dot)", "var(--paper)", "var(--rail-active)"] as const;

function hashOf(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, MARBLE_HASH_MULT) + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

const digit = (n: number, place: number) => Math.floor((n / DECIMAL ** place) % DECIMAL);
/** A value in `[0, range)`, negated when the seed's digit at `place` is even, so shapes drift both ways. */
const unit = (n: number, range: number, place?: number) =>
  place !== undefined && digit(n, place) % 2 === 0 ? -(n % range) : n % range;

export function Marble({ seed, size = 32, className }: { seed: string; size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const n = hashOf(seed.toLowerCase());
  const shapes = [0, 1, 2].map((i) => {
    const m = n * (i + 1);
    return {
      fill: PALETTE[(n + i) % PALETTE.length],
      dx: unit(m, MARBLE.shiftRange, 1),
      dy: unit(m, MARBLE.shiftRange, 2),
      scale: MARBLE.scaleBase + unit(m, MARBLE.scaleRange) / MARBLE.scaleStep,
      rotate: unit(m, MARBLE.turn, 1),
    };
  });
  const [base, first, second] = shapes;
  if (!base || !first || !second) return null;
  const half = MARBLE.size / 2;
  return (
    <svg aria-hidden viewBox="0 0 80 80" width={size} height={size} className={className} fill="none">
      <mask id={`${id}m`} maskUnits="userSpaceOnUse" x={0} y={0} width={MARBLE.size} height={MARBLE.size}>
        <rect width={MARBLE.size} height={MARBLE.size} rx={MARBLE.size} fill="white" />
      </mask>
      <g mask={`url(#${id}m)`}>
        <rect width={MARBLE.size} height={MARBLE.size} fill={base.fill} />
        <path
          filter={`url(#${id}b)`}
          d={MARBLE_SHAPE_A}
          fill={first.fill}
          transform={`translate(${first.dx} ${first.dy}) rotate(${first.rotate} ${half} ${half}) scale(${second.scale})`}
        />
        <path
          filter={`url(#${id}b)`}
          style={{ mixBlendMode: "overlay" }}
          d={MARBLE_SHAPE_B}
          fill={second.fill}
          transform={`translate(${second.dx} ${second.dy}) rotate(${second.rotate} ${half} ${half}) scale(${second.scale})`}
        />
      </g>
      <defs>
        <filter id={`${id}b`} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity={0} result="clear" />
          <feBlend in="SourceGraphic" in2="clear" result="shape" />
          <feGaussianBlur stdDeviation={MARBLE.blur} result="blur" />
        </filter>
      </defs>
    </svg>
  );
}
