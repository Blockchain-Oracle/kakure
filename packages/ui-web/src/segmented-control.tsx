"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev ddoemonn/segmented-control (#23552): a radio group whose thumb slides on a spring,
 * with the selected labels masked inside the thumb so the label colour flips exactly under it.
 * Reskin to Mitoshi's choices (terminal.css `.tm-choice`): a surface plate on a hairline and an ink thumb with stage
 * ink, the vermilion focus ring; the motion library is replaced by a CSS spring (`--spring-mode-thumb`).
 * Arrow keys, Home and End move the selection, as in the original.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is an icon. */
  name?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T, event: { clientX: number; clientY: number }) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

const PERCENT = 100;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: SegmentedControlProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  // The stored value replacing the prerendered default must not slide on load; only later changes travel.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const count = Math.max(1, options.length);
  const found = options.findIndex((option) => option.value === value);
  const index = found < 0 ? 0 : found;
  const template = `repeat(${count}, minmax(0, 1fr))`;
  const segment = cx(
    "flex items-center justify-center gap-1.5 whitespace-nowrap px-3 text-mode-label",
    size === "sm" ? "h-7" : "h-8",
  );

  const go = (next: number) => {
    const option = options[(next + count) % count];
    const button = buttons.current[(next + count) % count];
    if (!option || !button) return;
    button.focus();
    const rect = button.getBoundingClientRect();
    onChange(option.value, { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  };

  const onKeyDown = (event: KeyboardEvent, i: number) => {
    const moves: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1 };
    if (event.key in moves) {
      event.preventDefault();
      go(moves[event.key] ?? i);
    } else if (event.key === "Home") {
      event.preventDefault();
      go(0);
    } else if (event.key === "End") {
      event.preventDefault();
      go(count - 1);
    }
  };

  const spring = settled
    ? "transition-transform duration-(--spring-mode-thumb-duration) ease-(--spring-mode-thumb) motion-reduce:transition-none"
    : "";

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        "relative inline-block select-none rounded-full bg-secondary p-0.5 shadow-[inset_0_0_0_1px_var(--border)]",
        className,
      )}
    >
      <div className="relative grid" style={{ gridTemplateColumns: template, touchAction: "manipulation" }}>
        {options.map((option) => (
          <span key={option.value} aria-hidden className={cx(segment, "text-muted-foreground")}>
            {option.label}
          </span>
        ))}
        <div
          aria-hidden
          className={cx(
            "pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-full bg-foreground",
            spring,
          )}
          style={{ width: `${PERCENT / count}%`, transform: `translateX(${index * PERCENT}%)` }}
        >
          <div
            className={cx("absolute inset-y-0 left-0 grid", spring)}
            style={{
              width: `${count * PERCENT}%`,
              gridTemplateColumns: template,
              transform: `translateX(${(-index * PERCENT) / count}%)`,
            }}
          >
            {options.map((option) => (
              <span key={option.value} className={cx(segment, "text-stage")}>
                {option.label}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: template }}>
          {options.map((option, i) => (
            // biome-ignore lint/a11y/useSemanticElements: 21st's pattern, buttons with roving focus inside a radiogroup
            <button
              key={option.value}
              ref={(node) => {
                buttons.current[i] = node;
              }}
              type="button"
              role="radio"
              aria-checked={i === index}
              aria-label={option.name}
              tabIndex={i === index ? 0 : -1}
              onClick={(event) => onChange(option.value, event)}
              onKeyDown={(event) => onKeyDown(event, i)}
              className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {option.name ? null : <span className="sr-only">{option.label}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
