"use client";

import { useId } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev jolbol1/searchfield (#1469), Kawase's SearchField source (kawase.md §4.8):
 * a search input with a leading glyph and a clear button. Reskin: the `input` fill, a pill corner, no border
 * or react-aria dependency (a native `type="search"` field), the accent focus ring.
 */
export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}

export function SearchField({ value, onChange, label, placeholder, className }: SearchFieldProps) {
  const id = useId();
  return (
    <div
      className={cx(
        "relative flex h-11 items-center rounded-full bg-input text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
        "focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-full w-full min-w-0 rounded-full bg-transparent pr-10 pl-10 text-row outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 grid size-8 place-items-center rounded-full text-muted-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
