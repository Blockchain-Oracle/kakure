import { cx } from "./cx";

/**
 * A real asset mark, never a stand-in logo (kawase.md §4.7, R4). Marks are vendored SVG files served from the
 * site itself, so showing one makes no third-party request. Without a mark it falls back to a labelled neutral
 * disc. Marks keep their own colours: nothing is tinted.
 */
export interface MarkProps {
  /** Same-origin URL of the vendored SVG, or null for the labelled disc. */
  src: string | null;
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

export function Mark({ src, label, size = "row", className }: MarkProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        className={cx("shrink-0 rounded-full", SIZE[size], className)}
        decoding="async"
      />
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
