import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev haydenbleasel/pill (#1600): a capsule with a status indicator.
 * Reskin to Mitoshi's tones: surface and wash plates, up/down with their ink hairline, sentence case; the indicator
 * is a 6 px dot and always sits next to a word, never colour alone.
 */
export type PillTone = "accent" | "neutral" | "warn" | "up" | "down" | "destructive" | "quiet";

const TONE: Record<PillTone, string> = {
  accent: "bg-accent text-accent-foreground",
  neutral: "bg-secondary text-secondary-foreground",
  warn: "bg-warn-surface text-warn",
  up: "bg-up-surface text-up shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--up)_45%,transparent)]",
  down: "bg-down-surface text-down shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--down)_45%,transparent)]",
  destructive: "bg-destructive-surface text-destructive",
  quiet: "bg-card text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]",
};

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  /** Shows the 6 px dot; `pulse` breathes it (still under reduced motion). */
  indicator?: boolean | "pulse";
  icon?: ReactNode;
  className?: string;
}

export function Pill({ tone = "neutral", children, indicator, icon, className }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-label",
        TONE[tone],
        className,
      )}
    >
      {indicator ? (
        <span
          aria-hidden
          className={cx("size-1.5 rounded-full bg-current", indicator === "pulse" && "motion-safe:animate-pulse")}
        />
      ) : null}
      {icon ? (
        <span aria-hidden className="[&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
