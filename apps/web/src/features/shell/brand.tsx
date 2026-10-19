import { cx } from "@kakure/ui-web";

/**
 * Kakure's mark: a sun half hidden below the horizon, for 隠れ "hidden". Drawn in `currentColor` so it sits in ink on
 * the vermilion disc (Mitoshi's seal: a 40 px accent disc holding the mark, Rail.tsx:133-140).
 */
export function KakureMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cx("shrink-0", className)} fill="currentColor">
      <path d="M6.5 14.25a5.5 5.5 0 0 1 11 0Z" />
      <rect x="3.5" y="15.75" width="17" height="2" rx="1" />
      <rect x="7.5" y="19" width="9" height="1.6" rx="0.8" opacity="0.55" />
    </svg>
  );
}

/** The vermilion seal disc with the mark (rail head, phone top line, dock seal). */
export function BrandDisc({ className }: { className?: string }) {
  return (
    <span className={cx("kk-disc", className)}>
      <KakureMark className="kk-disc-mark" />
    </span>
  );
}

/** The wordmark: KAKURE in Sora, spaced as Mitoshi's rail word, with 隠れ in Noto Serif JP. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("kk-wordmark", className)}>
      KAKURE
      <span lang="ja" className="kk-wordmark-kanji">
        隠れ
      </span>
    </span>
  );
}

/** The disc and the wordmark together (the landing header). */
export function Brand({ wordmark = true }: { wordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandDisc />
      {wordmark ? <Wordmark /> : null}
    </span>
  );
}
