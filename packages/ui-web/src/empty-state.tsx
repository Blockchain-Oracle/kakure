import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev serafimcloud/empty-state (#1435), Kawase's EmptyState source (kawase.md §4.8).
 * The dashed border, ring and hover shadows are gone (depth from fills). Kawase's rule: an empty state says
 * why and names the next action; an error says what still works plus one action (kawase.md §3.3).
 */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  reason: ReactNode;
  /** One next action (a Button or a link styled with buttonClass). */
  action?: ReactNode;
  /** Technical detail behind a disclosure, never in the headline. */
  detail?: string;
  tone?: "neutral" | "warn" | "destructive";
  className?: string;
}

const TONE: Record<NonNullable<EmptyStateProps["tone"]>, string> = {
  neutral: "bg-secondary text-vermilion",
  warn: "bg-warn-surface text-warn",
  destructive: "bg-destructive-surface text-destructive",
};

export function EmptyState({ icon, title, reason, action, detail, tone = "neutral", className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex w-full flex-col items-center rounded-group border border-border bg-card px-6 py-12 text-center text-card-foreground",
        className,
      )}
    >
      {icon ? (
        <div className={cx("grid size-12 place-items-center rounded-full [&_svg]:size-6", TONE[tone])} aria-hidden>
          {icon}
        </div>
      ) : null}
      <h2 className="mt-5 font-display text-sheet-heading text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-body text-muted-foreground">{reason}</p>
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div> : null}
      {detail ? (
        <details className="mt-5 max-w-md text-meta text-muted-foreground">
          <summary className="cursor-pointer select-none rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Details
          </summary>
          <p className="mt-2 break-words font-sans">{detail}</p>
        </details>
      ) : null}
    </div>
  );
}
