"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { cx } from "./cx";
import { useMeasuredPill } from "./use-pill";

/**
 * Adapted from 21st.dev chetanverma16/animated-tabs (#525): one pill slides to the active tab.
 * Reskin per ui-components.md: the pill is the `row-pressed` fill (no shadow, no backdrop blur, no dark glass),
 * labels in Inter 14/600, and the motion library's `layoutId` is replaced by a measured pill on the `rail-pill` spring.
 * The panel is not part of this component: tabs here filter one list, so the list stays mounted.
 */
export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** e.g. the number of open markets; read as part of the name. */
  count?: number;
  icon?: ReactNode;
}

export interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** id of the element the tabs control (aria-controls). */
  controls?: string;
  className?: string;
}

export function Tabs<T extends string>({ items, value, onChange, label, controls, className }: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);
  const pill = useMeasuredPill(list, value, "rail-pill");

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.value === value);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = items[(index + step + items.length) % items.length];
    if (next) {
      onChange(next.value);
      list.current?.querySelector<HTMLElement>(`[data-pill-key="${next.value}"]`)?.focus();
    }
  };

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("relative flex w-fit max-w-full gap-1 overflow-x-auto", className)}
    >
      {pill ? (
        <span
          aria-hidden
          className={cx("absolute top-0 left-0 rounded-full bg-row-pressed", pill.className)}
          style={pill.style}
        />
      ) : null}
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            data-pill-key={item.value}
            aria-selected={selected}
            aria-controls={controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cx(
              "kk-press relative z-10 flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 text-chip-category outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              !pill && selected && "bg-row-pressed",
            )}
          >
            {item.icon ? (
              <span aria-hidden className="[&_svg]:size-4">
                {item.icon}
              </span>
            ) : null}
            {item.label}
            {item.count === undefined ? null : <span className="text-money-meta tabular-nums">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
