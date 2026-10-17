import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Kawase's receipt slip (kawase.md §6.1), adapted from 21st.dev ravikatiyar162/ticket-confirmation-card (#6492):
 * a head with the brand and a folio, the result (the figure in the condensed display face, with a stamp), facts as
 * label/value rows, then a perforation (a dashed rule with notches cut in the colour of the ground) and a stub.
 * Paper is the `card` plate with the `receipt` shadow, radius 20; no border.
 */
export interface StubFact {
  label: string;
  value: ReactNode;
}

export interface TicketStubProps {
  brand: ReactNode;
  folio: string;
  eyebrow: string;
  figure: ReactNode;
  caption?: ReactNode;
  stamp?: { word: string; tone: "up" | "down" | "warn" | "neutral" };
  facts: ReadonlyArray<StubFact>;
  stub?: ReactNode;
  /** Utility class of the surface the slip sits on, so the notches match it. */
  ground?: string;
  className?: string;
}

const STAMP_TONE = {
  up: "text-up",
  down: "text-down",
  warn: "text-warn",
  neutral: "text-muted-foreground",
} as const;

export function TicketStub({
  brand,
  folio,
  eyebrow,
  figure,
  caption,
  stamp,
  facts,
  stub,
  ground = "bg-background",
  className,
}: TicketStubProps) {
  return (
    <article className={cx("relative w-full rounded-receipt bg-card text-card-foreground shadow-receipt", className)}>
      <div className="flex flex-col gap-5 p-5">
        <header className="flex items-center justify-between gap-3">
          {brand}
          <span className="text-label text-muted-foreground tabular-nums">Ticket {folio}</span>
        </header>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-label text-muted-foreground">{eyebrow}</div>
            <div className="mt-1 font-display text-display-price text-foreground">{figure}</div>
            {caption ? <div className="mt-1 text-row-detail text-muted-foreground">{caption}</div> : null}
          </div>
          {stamp ? (
            <span
              className={cx(
                "grid size-20 shrink-0 -rotate-12 place-items-center rounded-full font-display text-title font-black",
                "shadow-[inset_0_0_0_3px_currentColor]",
                STAMP_TONE[stamp.tone],
              )}
            >
              {stamp.word}
            </span>
          ) : null}
        </div>
        <dl className="flex flex-col gap-2.5">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-meta text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 text-right text-row-strong break-words text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {stub ? (
        <>
          <div aria-hidden className="relative h-0">
            <span className={cx("absolute top-0 -left-3 size-6 -translate-y-1/2 rounded-full", ground)} />
            <span className={cx("absolute top-0 -right-3 size-6 -translate-y-1/2 rounded-full", ground)} />
            <span className="absolute inset-x-5 top-0 border-t-2 border-dashed border-row-pressed" />
          </div>
          <div className="p-5">{stub}</div>
        </>
      ) : null}
    </article>
  );
}
