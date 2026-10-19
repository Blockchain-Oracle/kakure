"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev ddoemonn/filter-grid (#23525) and preetsuthar17/selector-chips (#1963). Reskin to Mitoshi's
 * lanes (terminal.css `.tm-lane`): 32 px chips, a surface plate on a hairline at rest and the ink plate with stage
 * ink when selected; the per-filter count from filter-grid; no width springs or motion library.
 */
export interface ChipProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  /** `radio` inside a single-choice group, `toggle` for an on/off filter. */
  kind?: "radio" | "toggle";
  icon?: ReactNode;
}

export function Chip({ selected, onClick, children, count, kind = "radio", icon }: ChipProps) {
  const state =
    kind === "radio" ? ({ role: "radio", "aria-checked": selected } as const) : { "aria-pressed": selected };
  return (
    <button
      type="button"
      {...state}
      onClick={onClick}
      className={cx(
        "kk-press inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-chip-label outline-none",
        "transition-colors duration-[var(--duration-selection)] ease-default",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-stage",
        selected
          ? "bg-foreground text-stage"
          : "bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:text-foreground",
      )}
    >
      {icon ? (
        <span aria-hidden className="[&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      {children}
      {count === undefined ? null : <span className="text-money-meta tabular-nums">{count}</span>}
    </button>
  );
}

export function ChipGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}
