import { cx } from "@kakure/ui-web";

/**
 * Kakure's mark: an ink tile (Kawase's KawaseMark grammar, kawase.md §4.7) holding a disc half hidden behind the
 * horizon, for 隠れ "hidden". Drawn with tokens, so it follows the theme.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={cx("size-7 shrink-0", className)}>
      <rect width="28" height="28" rx="8" fill="var(--primary)" />
      <circle cx="14" cy="15.5" r="6.5" fill="var(--accent)" />
      <rect x="5" y="15.5" width="18" height="8" fill="var(--primary)" />
      <rect x="6" y="15" width="16" height="1.6" rx="0.8" fill="var(--primary-foreground)" />
    </svg>
  );
}

export function Brand({ wordmark = true }: { wordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      {wordmark ? (
        <span className="whitespace-nowrap font-display text-title font-black tracking-[-0.02em] text-foreground">
          Kakure
        </span>
      ) : null}
    </span>
  );
}
