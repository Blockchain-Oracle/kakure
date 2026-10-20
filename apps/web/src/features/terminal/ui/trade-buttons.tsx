"use client";

import { cx } from "@kakure/ui-web";
import { ArrowDown, ArrowUp, ArrowUpRight, Info, LoaderCircle, X } from "lucide-react";
import { PERCENT } from "../constants";
import type { Busy } from "../use-trade";

/**
 * The two trade buttons (Owarine `ui/TradeButtons.tsx`, Tradash's `a4`/`a6`). Flat: UP and DOWN, soft-tinted, each with
 * what it pays. Holding a position on this Window: TRAIL (greyed until the move past break-even beats the trail
 * distance, solid while armed) and CLOSE. They cross-fade between the two (y 12 → 0 in 0.18 s).
 */
const SLOT =
  "flex h-16 w-full items-center justify-center gap-2 rounded-full text-[1.0625rem] font-extrabold tracking-[0.2em] transition-[transform,opacity,background-color] duration-150 active:scale-[0.97] disabled:pointer-events-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** 0.1 % reads "0.1" and 1 % reads "1": one decimal under 1 %, none above. */
export const trailWords = (pct: number): string => (pct * PERCENT).toFixed(pct * PERCENT < 1 ? 1 : 0);

export type TradeButtonsProps =
  | {
      mode: "flat";
      onUp: () => void;
      onDown: () => void;
      busy: Busy;
      disabled?: boolean;
      upSub?: string | undefined;
      downSub?: string | undefined;
      /** Parlay mode: the side this Window already has in the slip shows solid. */
      picked?: "U" | "D" | null;
      /** While the buttons are off: why, in one plain sentence. */
      why?: string | null;
    }
  | {
      mode: "open";
      trailActive: boolean;
      trailEligible: boolean;
      trailPct: number;
      onTrail: () => void;
      onClose: () => void;
      busy: Busy;
      /** The Window stopped taking trades: it pays at its close. */
      lockedText?: string | null;
    };

export function TradeButtons(props: TradeButtonsProps) {
  const spin = <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin" />;
  if (props.mode === "flat") {
    const off = props.disabled || props.busy !== null;
    return (
      <div key="flat" className="kk-swap grid w-full grid-cols-2 gap-3">
        {props.disabled && props.why ? (
          <p
            role="status"
            className="col-span-2 flex items-start gap-2 rounded-group bg-secondary px-3 py-2.5 text-meta text-foreground"
          >
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{props.why}</span>
          </p>
        ) : null}
        {(
          [
            ["U", "UP", ArrowUp, props.onUp, props.upSub],
            ["D", "DOWN", ArrowDown, props.onDown, props.downSub],
          ] as const
        ).map(([side, word, Icon, onClick, sub]) => (
          <button
            key={side}
            type="button"
            onClick={onClick}
            disabled={off}
            aria-pressed={props.picked === undefined ? undefined : props.picked === side}
            className={cx(
              SLOT,
              props.picked === side
                ? side === "U"
                  ? "kk-up-solid"
                  : "kk-down-solid"
                : side === "U"
                  ? "kk-up-soft"
                  : "kk-down-soft",
              "disabled:opacity-40",
            )}
          >
            {props.busy === side ? spin : <Icon aria-hidden className="size-5" strokeWidth={3} />}
            <span className="flex flex-col items-start leading-none">
              <span>{word}</span>
              {sub ? (
                <span className="mt-1 text-[0.6875rem] font-semibold tracking-normal opacity-80">{sub}</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    );
  }
  const locked = Boolean(props.lockedText);
  return (
    <div key="open" className="kk-swap grid w-full grid-cols-2 gap-3">
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={props.onTrail}
          aria-pressed={props.trailActive}
          disabled={props.busy !== null || locked || (!props.trailActive && !props.trailEligible)}
          className={cx(SLOT, props.trailActive ? "kk-up-solid" : "kk-up-soft", "disabled:opacity-40")}
        >
          {props.busy === "trail" ? spin : <ArrowUpRight aria-hidden className="size-5" strokeWidth={3} />}
          {props.trailActive ? "TRAILING" : "TRAIL"}
        </button>
        <span className="text-[0.6875rem] text-muted-foreground">
          {locked
            ? ""
            : props.trailActive
              ? "At the mint · fires with this tab closed"
              : props.trailEligible
                ? ""
                : `Needs +${trailWords(props.trailPct)}% past break-even`}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1.5 self-start">
        <button
          type="button"
          onClick={props.onClose}
          disabled={props.busy !== null || locked}
          className={cx(SLOT, "kk-down-soft disabled:opacity-40")}
        >
          {props.busy === "close" ? spin : <X aria-hidden className="size-5" strokeWidth={3} />}
          CLOSE
        </button>
        {props.lockedText ? <span className="text-[0.6875rem] text-muted-foreground">{props.lockedText}</span> : null}
      </div>
    </div>
  );
}
