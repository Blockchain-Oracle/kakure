"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "./cx";

/**
 * A centred modal on the native <dialog> (focus trap, Escape and the top layer for free): Mitoshi's 440 px modal
 * (the shortcuts list) or a wider panel (the search palette). Motion is CSS (`.kk-modal` in kit.css).
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** The accessible name; shown as the heading unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  children: ReactNode;
  size?: "default" | "wide";
  className?: string;
}

export function Modal({ open, onClose, title, hideTitle = false, children, size = "default", className }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the dialog's own cancel
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      data-size={size}
      className={cx("kk-modal", className)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <h2 id={titleId} className={hideTitle ? "sr-only" : "px-5 pt-5 font-display text-sheet-heading text-foreground"}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}
