"use client";

import { cx, Mark } from "@kakure/ui-web";
import { type MouseEvent, useCallback, useRef, useState } from "react";
import { NETWORK_LABEL } from "@/constants";
import { MainnetSheet } from "./mainnet-sheet";
import { switchNetwork, useNetwork } from "./network-store";

function centreOf(element: HTMLElement | null) {
  const rect = element?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
}

/** The flood starts once the sheet has slid away, so it visibly spreads from the capsule. */
function afterSheetExit(run: () => void) {
  const ms = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--duration-sheet-exit"));
  setTimeout(run, Number.isFinite(ms) ? ms : 0);
}

/**
 * The network capsule (Kawase ModeCapsule, kawase.md §5): a 34 px borderless capsule on the network plate with the
 * Zcash mark, the word, and a small two-position switch (track 28 × 16, border 1.5, knob 9) whose knob springs.
 * Testnet's track is hollow and mainnet's filled, so the state reads by word and shape, not colour alone.
 * One tap switches to testnet; mainnet asks for "Slide to use real money" first (Senryo's NetworkPicker).
 * It carries the app's one glow, breathing on the ambient loop (static under reduced motion): the explicit
 * exception to Kawase's ban (plan §1, R10). The words and knob are driven by <html data-network> in CSS, so the
 * prerendered page never shows the wrong network.
 */
export function NetworkCapsule({ compact = false }: { compact?: boolean }) {
  const network = useNetwork();
  const [confirming, setConfirming] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const mainnet = network === "mainnet";

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (mainnet) {
      switchNetwork("testnet", event.detail > 0 ? { x: event.clientX, y: event.clientY } : centreOf(button.current));
    } else {
      setConfirming(true);
    }
  };

  const onConfirmed = useCallback(() => {
    setConfirming(false);
    afterSheetExit(() => switchNetwork("mainnet", centreOf(button.current)));
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        role="switch"
        aria-checked={mainnet}
        aria-label={`Network: ${NETWORK_LABEL[network]}. ${mainnet ? "Switch to Testnet" : "Switch to Mainnet (real ZEC)"}`}
        onClick={onClick}
        className={cx(
          "kk-press kk-network-capsule group inline-flex h-(--size-mode-capsule-height) shrink-0 items-center gap-2 rounded-full bg-network-surface outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          compact ? "px-2" : "pr-2 pl-1.5",
        )}
      >
        {compact ? null : <Mark mark="mark-zec" label="ZEC" size="inline" />}
        {compact ? null : (
          <span aria-hidden className="text-mode-label text-network-label">
            <span className="kk-when-mainnet">{NETWORK_LABEL.mainnet}</span>
            <span className="kk-when-testnet">{NETWORK_LABEL.testnet}</span>
          </span>
        )}
        <span
          aria-hidden
          className="kk-mode-track relative h-(--size-mode-track-height) w-(--size-mode-track-width) rounded-full"
        >
          <span className="kk-mode-knob absolute top-1/2 left-0.5 size-(--size-mode-knob) rounded-full" />
        </span>
      </button>
      <MainnetSheet open={confirming} onClose={() => setConfirming(false)} onConfirm={onConfirmed} />
    </>
  );
}
