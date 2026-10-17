"use client";

import type { AddressList, Market, Network, Side } from "@kakure/domain";
import { cx } from "@kakure/ui-web";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { sidesOf, sideWord } from "@/features/markets/market-view";

/** The sheet, its QR code and the WebAssembly address check load only when someone starts a bet. */
const BetSheet = dynamic(() => import("./bet-sheet"), { ssr: false });

const PLATE: Record<string, string> = {
  U: "bg-up-fill shadow-[inset_0_-3px_0_var(--up-fill-edge)]",
  Y: "bg-up-fill shadow-[inset_0_-3px_0_var(--up-fill-edge)]",
  D: "bg-down-fill shadow-[inset_0_-3px_0_var(--down-fill-edge)]",
  N: "bg-down-fill shadow-[inset_0_-3px_0_var(--down-fill-edge)]",
};
const SIGN: Record<string, string> = { U: "▲", D: "▼", Y: "✓", N: "✕" };

/** Up / Down as Kawase's vivid direction plates with black labels, a sign and a word (never colour alone). */
export function BetLauncher({
  market,
  addresses,
  network,
}: {
  market: Market;
  addresses: AddressList | null;
  network: Network;
}) {
  const [side, setSide] = useState<Side | null>(null);
  const close = useCallback(() => setSide(null), []);
  return (
    <section className="rounded-group bg-card p-5" aria-label="Place a bet">
      <div className="grid grid-cols-2 gap-3">
        {sidesOf(market).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSide(value as Side)}
            className={cx(
              "kk-press flex h-14 items-center justify-center gap-2 rounded-button text-button-label text-on-fill outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              PLATE[value],
            )}
          >
            <span aria-hidden>{SIGN[value]}</span> Bet {sideWord(value)}
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-meta text-muted-foreground">
        Fixed tickets from 0.01 to 1. You pay from your own wallet by QR; no account.
      </p>
      {side ? <BetSheet market={market} addresses={addresses} network={network} side={side} onClose={close} /> : null}
    </section>
  );
}
