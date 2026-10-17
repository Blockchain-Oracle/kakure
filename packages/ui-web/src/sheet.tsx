"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev wensity/drawer (#31360), Kawase's sheet source (kawase.md §4.8): a bottom sheet on phones
 * and a 384 px right drawer from the rail breakpoint, with Kawase's sheet curve, 480 ms in / 240 ms out, radius 24,
 * the 36 × 4 handle and the scrim. Base UI is replaced by the native modal <dialog> (focus trap, Escape and the top
 * layer for free); motion is CSS (`.kk-sheet` in kit.css) and becomes a 100 ms fade under reduced motion.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the dialog's own cancel
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={cx("kk-sheet", className)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[inherit] flex-col overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div aria-hidden className="mx-auto mb-3.5 h-1 w-9 shrink-0 rounded-full bg-sheet-handle rail:hidden" />
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-sheet-title text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="kk-press -mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
