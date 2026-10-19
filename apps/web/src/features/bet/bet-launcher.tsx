"use client";

import type { AddressList, Market, Network, Side } from "@kakure/domain";
import { cx } from "@kakure/ui-web";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { sidesOf, sideWord } from "@/features/markets/market-view";

/** The sheet, its QR code and the WebAssembly address check load only when someone starts a bet. */
const BetSheet = dynamic(() => import("./bet-sheet"), { ssr: false });

const UP = "bg-up-surface text-up shadow-[inset_0_0_0_1px_var(--up)] hover:bg-up hover:text-on-fill";
const DOWN = "bg-down-surface text-down shadow-[inset_0_0_0_1px_var(--down)] hover:bg-down hover:text-on-fill";
const PLATE: Record<string, string> = { U: UP, Y: UP, D: DOWN, N: DOWN };
const SIGN: Record<string, string> = { U: "▲", D: "▼", Y: "✓", N: "✕" };

/**
 * Up / Down as Mitoshi's direction buttons (tokens.css button-up/-down): the profit or loss wash with its ink and an
 * ink border, filled on hover; a sign and a word, never colour alone. Mint and rose mean direction only.
 */
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
    <section className="rounded-group border border-border bg-card p-5" aria-label="Place a bet">
      <div className="grid grid-cols-2 gap-3">
        {sidesOf(market).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSide(value as Side)}
            className={cx(
              "kk-press flex h-(--size-cta-height) items-center justify-center gap-2 rounded-button text-button-label outline-none transition-colors duration-(--duration-hover)",
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
