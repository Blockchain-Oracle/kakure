"use client";

import { cadenceLabel, PARLAY_MAX_LEGS } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { cx, Mark, RollingNumber } from "@kakure/ui-web";
import { ArrowDownRight, ArrowUpRight, Layers, LoaderCircle, Plus, X } from "lucide-react";
import { assetFor } from "@/features/markets/assets";
import { PARLAY_STAKE_CHIPS_ZAT, PERCENT } from "../constants";
import { centsOf, fixedText, untilText, zecText } from "../format";
import type { LegLive, ParlayEstimate } from "./estimate";
import { clearSlip, legOpen, removeLeg, type SlipLeg, setSlipStake } from "./slip";

/**
 * The parlay slip (Owarine `parlay/ParlaySlip.tsx`): two or three Windows of any markets on one ticket, priced live
 * (each leg's price, the combined chance and what the ticket pays move with the stream) and bought in one tap. Every
 * leg must land; the mint sets the full payout aside when it's bought, and it can't be sold back.
 */
const tap = () => fire("toggle", { haptic: "tick" });
const markOf = (asset: string) => assetFor({ kind: "close", subject: asset }).mark;
const SMALL_CHANCE_PCT = 10;

export function ParlaySlip({
  legs,
  live,
  estimate,
  stakeZat,
  ownStake,
  coin,
  nowSec,
  entryBufferSec,
  busy,
  onPlace,
  onAddMarket,
  className,
}: {
  legs: readonly SlipLeg[];
  live: readonly LegLive[];
  estimate: ParlayEstimate;
  stakeZat: number;
  /** The slip has its own stake (a chip was picked), rather than following the screen's size. */
  ownStake: boolean;
  coin: string;
  nowSec: number;
  entryBufferSec: number;
  busy: boolean;
  onPlace: () => void;
  onAddMarket: () => void;
  className?: string;
}) {
  const quote = estimate.ok ? estimate.quote : null;
  const multiple = quote ? quote.payoutZat / quote.stakeZat : 0;
  const chancePct = quote ? quote.chance * PERCENT : null;
  const failedLeg = estimate.ok ? null : estimate.legIdx;

  return (
    <div className={cx("flex flex-col gap-3 rounded-group bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-[0.12em] text-muted-foreground">
          <Layers aria-hidden className="size-3.5" /> PARLAY · {legs.length}/{PARLAY_MAX_LEGS}
        </span>
        {legs.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              tap();
              clearSlip();
            }}
            className="text-meta text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>

      {legs.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          Tap UP or DOWN to add this market. Then pick another market and add it too. Every leg must land, and the odds
          multiply.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {legs.map((leg, i) => (
            <li key={leg.window} className="kk-swap">
              <SlipLegRow
                leg={leg}
                live={live[i] ?? null}
                askE4={quote?.legAsksE4[i] ?? live[i]?.askE4 ?? null}
                open={legOpen(leg.expirySec, entryBufferSec, nowSec)}
                nowSec={nowSec}
                flagged={failedLeg === i}
              />
            </li>
          ))}
        </ul>
      )}

      {legs.length < PARLAY_MAX_LEGS ? (
        <button
          type="button"
          onClick={() => {
            tap();
            onAddMarket();
          }}
          className="flex h-9 items-center justify-center gap-1.5 rounded-full border border-dashed border-border text-meta font-semibold text-muted-foreground hover:text-foreground"
        >
          <Plus aria-hidden className="size-4" /> {legs.length === 0 ? "Pick a market" : "Add another market"}
        </button>
      ) : null}

      {legs.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-meta text-muted-foreground">Stake</span>
            <div className="flex items-center gap-1">
              {PARLAY_STAKE_CHIPS_ZAT.map((zat) => (
                <button
                  key={zat}
                  type="button"
                  onClick={() => {
                    tap();
                    setSlipStake(ownStake && stakeZat === zat ? null : zat);
                  }}
                  aria-pressed={ownStake && stakeZat === zat}
                  className={cx(
                    "numbers h-7 min-w-9 rounded-full px-2 text-[0.6875rem] font-bold",
                    ownStake && stakeZat === zat ? "bg-foreground text-stage" : "bg-secondary text-foreground",
                  )}
                >
                  {zecText(zat)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-meta text-muted-foreground">Pays</span>
              <span className="numbers font-display text-title text-foreground">
                {quote ? <RollingNumber value={`${multiple.toFixed(2)}×`} /> : "—"}
              </span>
            </div>
            <div className="flex flex-col items-end text-right">
              <span className="text-meta text-muted-foreground">If all {legs.length} land</span>
              <span className={cx("numbers text-row-strong", quote ? "text-up" : "text-muted-foreground")}>
                {quote ? <RollingNumber value={`${zecText(quote.payoutZat)} ${coin}`} /> : "—"}
              </span>
            </div>
          </div>

          <p className={cx("text-meta", estimate.ok ? "text-muted-foreground" : "text-down")}>
            {quote
              ? `${chancePct === null ? "" : `${fixedText(chancePct, chancePct < SMALL_CHANCE_PCT ? 1 : 0)}% chance all land`}${quote.correlated ? " · legs close together, so the odds are trimmed" : ""}`
              : estimate.ok
                ? ""
                : estimate.why}
          </p>

          <button
            type="button"
            disabled={!quote || busy}
            onClick={onPlace}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-[1.0625rem] font-extrabold tracking-[0.04em] text-primary-foreground transition-[transform,opacity] duration-150 active:scale-[0.97] disabled:opacity-40"
          >
            {busy ? <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin" /> : null}
            {busy ? "Placing…" : quote ? `Place parlay · ${zecText(quote.stakeZat)} ${coin}` : "Place parlay"}
          </button>
          <p className="text-center text-meta text-muted-foreground">
            Can't be sold early. Pays when the last leg closes.
          </p>
        </>
      ) : null}
    </div>
  );
}

function SlipLegRow({
  leg,
  live,
  askE4,
  open,
  nowSec,
  flagged,
}: {
  leg: SlipLeg;
  live: LegLive | null;
  askE4: number | null;
  open: boolean;
  nowSec: number;
  flagged: boolean;
}) {
  const Dir = leg.side === "U" ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      className={cx(
        "flex items-center gap-2.5 rounded-row bg-secondary px-2.5 py-2",
        flagged && "outline outline-1 outline-down",
      )}
    >
      <Mark mark={markOf(leg.asset)} label={leg.asset} size="token" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-row-strong text-foreground">
          {leg.asset}
          <Dir aria-hidden className={cx("size-4", leg.side === "U" ? "text-up" : "text-down")} strokeWidth={2.75} />
          <span className="text-meta text-muted-foreground">{cadenceLabel(leg.cadenceSec)}</span>
        </span>
        <span className="block truncate text-meta text-muted-foreground">
          {open ? `closes ${untilText(leg.expirySec, nowSec)}` : "next Window…"}
          {live?.lead ? (
            <span className={live.lead === "ahead" ? "text-up" : "text-down"}>
              {" "}
              · {live.lead === "ahead" ? "ahead" : "behind"}
            </span>
          ) : null}
        </span>
      </span>
      <span className="numbers text-meta font-bold text-foreground">{askE4 === null ? "—" : centsOf(askE4)}</span>
      <button
        type="button"
        aria-label={`Remove ${leg.asset}`}
        onClick={() => {
          tap();
          removeLeg(leg.window);
        }}
        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
