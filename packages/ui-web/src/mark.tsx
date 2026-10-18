import { cx } from "./cx";

/**
 * A real asset mark, never a stand-in logo (kawase.md §4.7, R4). Marks come from an inline SVG sprite the page
 * carries for every visitor (`<symbol id="mark-…">`), so showing one makes no request at all, not even one that
 * would name the asset (O7). Without a mark it falls back to a labelled neutral disc. Marks keep their own colours.
 */
export interface MarkProps {
  /** Id of the mark's `<symbol>` in the page's sprite, or null for the labelled disc. */
  mark: string | null;
  /** Ticker or short name, used for the fallback disc. */
  label: string;
  size?: "inline" | "token" | "row" | "detail";
  className?: string;
}

const SIZE = {
  inline: "size-5 text-[9px]",
  token: "size-8 text-[11px]",
  row: "size-9 text-[12px]",
  detail: "size-12 text-[14px]",
} as const;

const MONOGRAM_LENGTH = 4;

export function Mark({ mark, label, size = "row", className }: MarkProps) {
  if (mark) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cx("shrink-0 rounded-full", SIZE[size], className)}>
        <use href={`#${mark}`} />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center rounded-full bg-secondary font-sans font-semibold text-secondary-foreground",
        SIZE[size],
        className,
      )}
    >
      {label.slice(0, MONOGRAM_LENGTH)}
    </span>
  );
}
