import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev preetsuthar17/timeline (#5157): a vertical list of steps with status markers.
 * Reskin per Kawase TxSteps (kawase.md §3.3): a check when done, a pulse when active, a hollow ring when pending;
 * the connector is a quiet fill, not a border; no cva, scroll area or card chrome.
 */
export type TimelineStatus = "done" | "active" | "pending";

export interface TimelineItem {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  time?: ReactNode;
  status: TimelineStatus;
}

function Marker({ status }: { status: TimelineStatus }) {
  if (status === "done") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-foreground text-background" aria-hidden>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M2.5 6.2 5 8.5 9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="grid size-5 place-items-center" aria-hidden>
        <span className="kk-step-active size-3 rounded-full bg-accent" />
      </span>
    );
  }
  return (
    <span className="grid size-5 place-items-center" aria-hidden>
      <span className="size-3 rounded-full shadow-[inset_0_0_0_2px_var(--silver)]" />
    </span>
  );
}

const STATUS_WORD: Record<TimelineStatus, string> = { done: "Done", active: "Now", pending: "Next" };

export function Timeline({
  items,
  label,
  className,
}: {
  items: ReadonlyArray<TimelineItem>;
  label: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cx("flex flex-col", className)}>
      {items.map((item, i) => (
        <li key={item.key} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 ? (
            <span aria-hidden className="absolute top-6 bottom-0 left-[9px] w-0.5 rounded-full bg-row-pressed" />
          ) : null}
          <Marker status={item.status} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span
                className={cx(
                  "text-row-strong",
                  item.status === "pending" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                <span className="sr-only">{STATUS_WORD[item.status]}: </span>
                {item.title}
              </span>
              {item.time ? <span className="text-money-meta text-muted-foreground">{item.time}</span> : null}
            </div>
            {item.detail ? <p className="mt-0.5 text-row-detail text-muted-foreground">{item.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
