"use client";

import { cx } from "./cx";

/**
 * Adapted from 21st.dev serafimcloud/switch (#21948): a spring-eased thumb. Reskin: the solid `network`-style
 * track (accent when on, the quiet plate when off) instead of the gradient, the `compact-selector` spring, a native
 * button with role="switch" instead of Base UI. 44 px touch target around the 28 × 16 track.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cx(
          "relative h-6 w-10 rounded-full transition-colors duration-(--duration-selection) ease-default",
          checked ? "bg-accent" : "bg-row-pressed",
        )}
      >
        <span
          className={cx(
            "absolute top-1 left-1 size-4 rounded-full shadow-button transition-transform duration-(--spring-compact-selector-duration) ease-(--spring-compact-selector) motion-reduce:transition-none",
            checked ? "translate-x-4 bg-accent-foreground" : "bg-card",
          )}
        />
      </span>
    </button>
  );
}
