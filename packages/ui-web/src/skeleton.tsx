import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev anurag-mishra22/animated-loading-skeleton (#54). Its gradient, shadow, blur and motion
 * library are gone: Kawase skeletons are the `skeleton` fill, pulsing 0.65 → 1 over 1200 ms, and stand still under
 * reduced motion (kawase.md §4.5–4.6). Screens compose these into their own page shape; never a spinner page.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cx("kk-skeleton rounded-xs", className)} {...props} />;
}

/** A text line placeholder at the token height (14, or 10 for small). */
export function SkeletonLine({ small, className }: { small?: boolean; className?: string }) {
  return <Skeleton className={cx(small ? "h-2.5" : "h-3.5", "rounded-full", className)} />;
}
