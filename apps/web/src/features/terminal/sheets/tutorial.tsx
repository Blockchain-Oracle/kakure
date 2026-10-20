"use client";

import type { Network } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { cx } from "@kakure/ui-web";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronLeft, LineChart, Waves, X } from "lucide-react";
import { useState } from "react";
import { TOUR_STEP } from "../constants";

/**
 * The five-step tour (Owarine `sheets/Tutorial.tsx`, Tradash's `ax`): full screen, progress dashes, back (Skip on the
 * first step) and Skip; a drawn illustration, "STEP N", a title and a sentence; Next, and on the last step Deposit or
 * Start trading. Kakure's words: private chips, the house's public price, exits held by the mint.
 */
const STEPS = [
  {
    icon: LineChart,
    title: "Watch the market",
    body: "A live price chart is your whole workspace: the price, the line it has to beat, and the time left. No forms, no clutter.",
  },
  {
    icon: ArrowUp,
    title: "Tap UP or DOWN",
    body: "Think it closes above the line? Tap UP. Below? Tap DOWN. One tap buys with your private chips, and nobody can tell who you are.",
  },
  {
    icon: Waves,
    title: "Watch your PnL move",
    body: "Your profit or loss updates live on the price line as the market moves: green when you're up, red when you're down.",
  },
  {
    icon: ArrowUpRight,
    title: "Trail to lock profit",
    body: "Once you're in profit, tap Trail. It follows the price your way and closes if it turns, even with this tab closed.",
  },
  {
    icon: X,
    title: "Close to bank it",
    body: "Tap Close anytime to take your profit (or cut a loss). Winnings come back as fresh chips. That's the loop: watch, tap, manage, close.",
  },
] as const;

const NOTE: Record<Network, string> = {
  testnet: "This is Zcash testnet: test coins (TAZ) only, no real money.",
  mainnet: "This is Zcash mainnet: real ZEC. Trade what you can afford to lose.",
};

const LINE_PATH = "M8 120 C 50 110, 70 70, 110 80 S 170 40, 210 52 S 260 30, 292 26";

function Illustration({ step }: { step: number }) {
  return (
    <div className="relative h-44 w-72 overflow-hidden rounded-group border border-border bg-card">
      {step === TOUR_STEP.buttons ? (
        <div className="absolute inset-0 flex items-center justify-center gap-3">
          <span className="kk-up-soft flex h-12 w-28 items-center justify-center gap-1 rounded-full text-row-strong font-extrabold tracking-[0.15em]">
            <ArrowUp aria-hidden className="size-4" strokeWidth={3} /> UP
          </span>
          <span className="kk-down-soft flex h-12 w-28 items-center justify-center gap-1 rounded-full text-row-strong font-extrabold tracking-[0.15em]">
            <ArrowDown aria-hidden className="size-4" strokeWidth={3} /> DOWN
          </span>
        </div>
      ) : (
        <svg viewBox="0 0 300 150" className="absolute inset-0 h-full w-full" aria-hidden>
          {step === TOUR_STEP.trail ? (
            <line x1="8" x2="292" y1="78" y2="78" stroke="var(--up)" strokeDasharray="6 4" strokeWidth="1.5" />
          ) : null}
          <path
            d={LINE_PATH}
            fill="none"
            stroke="var(--up)"
            strokeWidth="3"
            strokeLinecap="round"
            className="kk-draw"
            pathLength={1}
          />
          <circle cx="292" cy="26" r="4" fill="var(--up)" />
        </svg>
      )}
      {step === TOUR_STEP.pnl || step === TOUR_STEP.close ? (
        <span className="numbers absolute top-3 right-3 rounded-full bg-up px-2.5 py-1 text-meta text-on-fill">
          +0.042
        </span>
      ) : null}
      {step === TOUR_STEP.trail ? (
        <span className="kk-up-solid absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-[0.6875rem] font-bold">
          <ArrowUpRight aria-hidden className="size-3" /> Trailing
        </span>
      ) : null}
      {step === TOUR_STEP.close ? (
        <span className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-3 py-1 text-[0.6875rem] font-bold text-stage">
          <X aria-hidden className="size-3" /> Close
        </span>
      ) : null}
    </div>
  );
}

export function Tutorial({
  open,
  network,
  onDone,
}: {
  open: boolean;
  network: Network;
  onDone: (choice: "deposit" | "trade" | "skip") => void;
}) {
  const [step, setStep] = useState(0);
  if (!open) return null;
  const s = STEPS[step] ?? STEPS[0];
  const last = step === STEPS.length - 1;
  const tap = () => fire("toggle", { haptic: "tick" });
  const finish = (choice: "deposit" | "trade" | "skip") => {
    tap();
    setStep(0);
    onDone(choice);
  };
  const Icon = s.icon;
  return (
    <div
      role="dialog"
      aria-modal
      aria-label="How it works"
      className="fixed inset-0 z-[9600] flex flex-col bg-stage/95 backdrop-blur-xl"
    >
      <header className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,0rem)+1rem)]">
        <button
          type="button"
          onClick={() => {
            if (step === 0) finish("skip");
            else {
              tap();
              setStep(step - 1);
            }
          }}
          className="flex items-center gap-1 text-meta text-muted-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {step === 0 ? "Skip" : "Back"}
        </button>
        <div className="flex gap-1.5">
          {STEPS.map((step_, i) => (
            <span
              key={step_.title}
              className={cx(
                "h-1.5 rounded-full transition-[width,background-color]",
                i === step ? "w-6 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>
        <button type="button" onClick={() => finish("skip")} className="text-meta text-muted-foreground">
          Skip
        </button>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div key={step} className="kk-swap flex flex-col items-center gap-4">
          <Illustration step={step} />
          <span className="flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-[0.12em] text-primary">
            <Icon aria-hidden className="size-3.5" /> STEP {step + 1}
          </span>
          <h2 className="font-display text-page-title">{s.title}</h2>
          <p className="max-w-sm text-row text-muted-foreground">{s.body}</p>
          <p className="max-w-sm text-meta text-muted-foreground">{NOTE[network]}</p>
        </div>
      </div>
      <footer className="flex flex-col gap-2 px-4 pb-[calc(env(safe-area-inset-bottom,0rem)+1rem)]">
        {last ? (
          <>
            <button
              type="button"
              onClick={() => finish("deposit")}
              className="h-14 rounded-full bg-primary text-row-strong text-primary-foreground"
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => finish("trade")}
              className="h-14 rounded-full bg-foreground text-row-strong text-stage"
            >
              Start trading
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              tap();
              setStep(step + 1);
            }}
            className="h-14 rounded-full bg-primary text-row-strong text-primary-foreground"
          >
            Next
          </button>
        )}
      </footer>
    </div>
  );
}
