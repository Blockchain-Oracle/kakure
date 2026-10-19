"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "./cx";

/**
 * Adapted from 21st.dev wensity/drawer (#31360): a bottom sheet on phones and a right drawer from 768 px, as
 * Mitoshi's drawers (384 px, or 560 px `wide`; 380 ms in on the drawer curve, 240 ms out; radius 24; the 36 × 4
 * handle; the scrim). Base UI is replaced by the native modal <dialog> (focus trap, Escape and the top layer for
 * free); motion is CSS (`.kk-sheet` in kit.css) and becomes a 100 ms fade under reduced motion.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  size?: "default" | "wide";
  /** Pinned under the scrolling body (More's tools). */
  footer?: ReactNode;
}

export function Sheet({ open, onClose, title, children, className, size = "default", footer }: SheetProps) {
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
      data-size={size}
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
      <div className="flex max-h-[inherit] flex-col rail:h-full">
        <div className="flex min-h-0 flex-auto flex-col overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] rail:p-6">
          <div aria-hidden className="mx-auto mb-3.5 h-1 w-9 shrink-0 rounded-full bg-sheet-handle rail:hidden" />
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display text-sheet-title text-foreground">
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
        {footer ? <div className="shrink-0 border-t border-border px-4 py-3 rail:px-6">{footer}</div> : null}
      </div>
    </dialog>
  );
}
