import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev 8starlabs/partition-bar (#26545): proportional segments with a title and value under each.
 * Reskin per ui-components.md: two direction plates (`up-fill` / `down-fill`, each with its darker 3 px edge),
 * labels carry a sign and a word so colour is never the only signal; no cva, no outline variant.
 */
export interface PartitionSegment {
  key: string;
  value: number;
  tone: "up" | "down";
  title: ReactNode;
  detail?: ReactNode;
}

const FILL: Record<PartitionSegment["tone"], string> = {
  up: "bg-up-fill shadow-[inset_0_-3px_0_var(--up-fill-edge)]",
  down: "bg-down-fill shadow-[inset_0_-3px_0_var(--down-fill-edge)]",
};

const PERCENT = 100;

export function PartitionBar({
  segments,
  label,
  className,
}: {
  segments: ReadonlyArray<PartitionSegment>;
  label: string;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <figure className={cx("w-full", className)} aria-label={label}>
      <div className="flex h-3 w-full gap-1">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={cx("h-full min-w-2 rounded-full", FILL[segment.tone])}
            style={{ flexBasis: `${total > 0 ? (segment.value / total) * PERCENT : PERCENT / segments.length}%` }}
          />
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between gap-4">
        {segments.map((segment, i) => (
          <div key={segment.key} className={cx("flex flex-col", i === segments.length - 1 && "items-end text-right")}>
            <span className="text-row-strong text-foreground">{segment.title}</span>
            {segment.detail ? <span className="text-money-meta text-muted-foreground">{segment.detail}</span> : null}
          </div>
        ))}
      </figcaption>
    </figure>
  );
}
