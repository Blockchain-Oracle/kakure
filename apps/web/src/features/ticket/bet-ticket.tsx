"use client";

import { type Market, quoteTicket, type Side, TICKET_SIZES_ZAT, zatToZec } from "@kakure/domain";
import { cx } from "@kakure/ui-web";
import { Banknote, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { isBettable, sidesOf, sideWord } from "@/features/markets/market-view";

/**
 * The bet ticket (plan §0 R2), after 21st.dev starc007/be-ui-prediction-market, reskinned to Mitoshi's tokens:
 * pick a side (each shows what it pays now), pick a ticket size, read "to win", one button. No address or rules here:
 * the payout address is one field in the pay sheet that follows, and the rules live behind the Rules button.
 * Numbers come from `quoteTicket`, the payout formula itself with your stake added, so the ticket never promises a
 * multiple the operator wouldn't pay. Sealed pools say so instead of guessing.
 */
const SIGN: Record<string, string> = { U: "▲", D: "▼", Y: "✓", N: "✕" };
const UPWARD = new Set(["U", "Y"]);
const BPS = 10_000;
const MULTIPLE_DECIMALS = 2;

export interface TicketChoice {
  side: Side;
  sizeZat: bigint;
}

export function BetTicket({
  market,
  coin,
  now,
  choice,
  onChoice,
  onBet,
}: {
  market: Market;
  coin: string;
  now: number;
  choice: TicketChoice;
  onChoice: (next: TicketChoice) => void;
  onBet: () => void;
}) {
  const open = isBettable(market, now) || now === 0;
  const sealed = market.sealed || !market.released;
  const pool = (side: string) => BigInt(market.released?.sides[side as Side]?.zat ?? "0");
  const quoteFor = (side: string) => {
    if (sealed) return null;
    const [a, b] = sidesOf(market);
    const other = side === a ? b : a;
    return quoteTicket(choice.sizeZat, pool(side), pool(other));
  };
  const selected = quoteFor(choice.side);
  const upward = UPWARD.has(choice.side);

  return (
    <section
      aria-label="Bet ticket"
      className="flex w-full flex-col overflow-hidden rounded-sheet border border-border bg-background"
    >
      <div className="grid grid-cols-2 gap-2 p-2">
        {sidesOf(market).map((side) => {
          const quote = quoteFor(side);
          const active = side === choice.side;
          const up = UPWARD.has(side);
          return (
            <button
              key={side}
              type="button"
              aria-pressed={active}
              onClick={() => onChoice({ ...choice, side: side as Side })}
              className={cx(
                "kk-press flex h-16 flex-col items-center justify-center rounded-group outline-none transition-colors duration-(--duration-hover)",
                "focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? up
                    ? "bg-up-surface text-up shadow-[inset_0_0_0_1px_var(--up)]"
                    : "bg-down-surface text-down shadow-[inset_0_0_0_1px_var(--down)]"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-button-label">
                <span aria-hidden>{SIGN[side]}</span> {sideWord(side).toUpperCase()}
              </span>
              <span className="font-mono text-num-sm">
                {quote ? `pays ${multiple(quote.multipleBps)}` : "odds sealed"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mx-2 rounded-group bg-card px-4 pt-5 pb-4">
        <div className="text-center text-label text-muted-foreground">Ticket</div>
        <div className="mt-1 flex items-baseline justify-center gap-2">
          <span key={choice.sizeZat.toString()} className="kk-roll-in font-mono text-display-balance text-foreground">
            {zatToZec(choice.sizeZat)}
          </span>
          <span className="text-body-strong text-muted-foreground">{coin}</span>
        </div>
        <fieldset className="mt-4 flex flex-wrap justify-center gap-1.5">
          <legend className="sr-only">Ticket size</legend>
          {TICKET_SIZES_ZAT.map((size) => (
            <button
              key={size.toString()}
              type="button"
              aria-pressed={size === choice.sizeZat}
              onClick={() => onChoice({ ...choice, sizeZat: size })}
              className={cx(
                "kk-press h-9 rounded-chip px-3 font-mono text-num-sm outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring",
                size === choice.sizeZat
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-raised-2",
              )}
            >
              {zatToZec(size)}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="mt-2 border-t border-border px-4 py-4">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-body-strong text-foreground">
              To win <Banknote aria-hidden className={cx("size-4", upward ? "text-up" : "text-down")} />
            </div>
            <div className="text-meta text-muted-foreground">
              {selected
                ? `as the pools stand · batch ${market.released?.seq}`
                : "odds open once each side has 3 tickets"}
            </div>
          </div>
          <div className="text-right">
            <div className={cx("font-mono text-display-price", selected ? "text-up" : "text-muted-foreground")}>
              {selected ? `${zatToZec(selected.payoutZat)}` : "—"}
            </div>
            {selected ? (
              <div className="font-mono text-num-sm text-muted-foreground">
                +{zatToZec(selected.profitZat)} {coin}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          disabled={!open}
          onClick={onBet}
          className={cx(
            "kk-press flex h-(--size-cta-height) w-full items-center justify-center gap-2 rounded-button text-button-label outline-none",
            "bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {open ? (
            <>
              <span aria-hidden>{SIGN[choice.side]}</span> Bet {sideWord(choice.side)} · {zatToZec(choice.sizeZat)}{" "}
              {coin}
            </>
          ) : (
            <>
              <LockKeyhole aria-hidden className="size-4" /> Betting closed
            </>
          )}
        </button>
        <Link
          href="/privacy"
          className="mt-3 flex items-center justify-center gap-1.5 text-meta text-muted-foreground hover:text-foreground"
        >
          <ShieldCheck aria-hidden className="size-3.5" /> The operator sees the bet, never who placed it
        </Link>
      </div>
    </section>
  );
}

function multiple(bps: bigint): string {
  return `${(Number(bps) / BPS).toFixed(MULTIPLE_DECIMALS)}×`;
}
