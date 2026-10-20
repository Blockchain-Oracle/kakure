"use client";

import { formatPrice } from "@kakure/chart";
import type { Network } from "@kakure/domain";
import { closeValueZat, MAX_ASK_E4, MIN_BID_E4, PRICE_SCALE_E4, type Trading, ZATOSHI_PER_ZEC } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { cx, Sheet } from "@kakure/ui-web";
import { useEffect, useState } from "react";
import { MintError } from "@/features/wallet/api";
import type { ExitPlan } from "@/features/wallet/records";
import { armExit, disarmExit } from "@/features/wallet/trading";
import { BPS, PERCENT } from "../constants";
import { zecText } from "../format";
import type { LivePosition } from "../positions";
import { toast } from "../toasts";

/**
 * TP / SL (Owarine `sheets/ExitSheet.tsx`): a take-profit in profit and a stop at a price, held by the mint, which
 * fills them at its bid even with this tab closed. A take-profit sells once closing pays the stake plus that profit; a
 * stop sells at the bid once the price crosses its level, on the losing side. A stop replaces a trailing stop (one
 * stop a position); a take-profit sits beside either.
 */
const ZAT_PER_ZEC = Number(ZATOSHI_PER_ZEC);

/** The bid at which closing pays `stake + profit`: null past what the position can pay. */
function takeProfitBid(stakeZat: number, payoutZat: number, profitZat: number): number | null {
  if (!(profitZat > 0) || payoutZat <= 0) return null;
  const bid = Math.ceil(((stakeZat + profitZat) * PRICE_SCALE_E4) / payoutZat);
  return bid >= MIN_BID_E4 && bid <= MAX_ASK_E4 ? bid : null;
}

export function ExitSheet({
  open,
  onClose,
  position,
  spot,
  coin,
  network,
  trading,
  slippageBps,
}: {
  open: boolean;
  onClose: () => void;
  position: LivePosition | null;
  spot: number | null;
  coin: string;
  network: Network;
  trading: Trading | null;
  slippageBps: number;
}) {
  const exit = position?.record.exit;
  const [profit, setProfit] = useState("");
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  // Opens on what the mint holds now.
  useEffect(() => {
    if (!open || !position) return;
    const tp = exit?.takeProfit?.bidE4;
    setProfit(
      tp === undefined
        ? ""
        : String(Math.max(0, closeValueZat(position.payoutZat, tp) - position.stakeZat) / ZAT_PER_ZEC),
    );
    setStop(exit?.stop ? String(exit.stop.price) : "");
  }, [open, position?.key]);

  if (!position?.side) {
    return (
      <Sheet open={open} onClose={onClose} title="TP / SL">
        <p className="py-6 text-center text-row text-muted-foreground">This position is no longer open.</p>
      </Sheet>
    );
  }

  const profitZat = profit.trim() === "" ? null : Math.round(Number(profit) * ZAT_PER_ZEC);
  const tpBid = profitZat === null ? null : takeProfitBid(position.stakeZat, position.payoutZat, profitZat);
  const stopPrice = stop.trim() === "" ? null : Number(stop);
  const up = position.side === "U";
  const trailing = exit?.trail !== undefined;
  const problem =
    profitZat !== null && tpBid === null
      ? "That profit is more than this position can pay."
      : stopPrice !== null && !(stopPrice > 0)
        ? "Enter a price."
        : stopPrice !== null && spot !== null && (up ? stopPrice >= spot : stopPrice <= spot)
          ? `A stop sits ${up ? "below" : "above"} the price ($${formatPrice(spot)}).`
          : null;
  const nothing = tpBid === null && stopPrice === null;

  const save = async () => {
    if (!trading) return;
    fire("toggle", { haptic: "tick" });
    setBusy(true);
    try {
      const keepTrail = stopPrice === null && exit?.trail ? exit.trail : null;
      const plan: ExitPlan = {
        ...(tpBid === null ? {} : { takeProfit: { bidE4: tpBid } }),
        ...(stopPrice === null ? {} : { stop: { price: stopPrice } }),
        ...(keepTrail ? { trail: keepTrail } : {}),
      };
      if (Object.keys(plan).length === 0) await disarmExit(network, trading, position.key);
      else await armExit(network, trading, position.key, plan);
      fire("confirmed");
      toast({
        kind: "success",
        title: nothing ? `TP / SL off · ${position.asset}` : `TP / SL at the mint · ${position.asset}`,
        ...(nothing ? {} : { description: "It fills at the house's bid, even with this tab closed." }),
      });
      onClose();
    } catch (error) {
      fire("error");
      toast({
        kind: "error",
        title: "TP / SL not saved",
        description: error instanceof MintError ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const field =
    "numbers w-full rounded-group bg-secondary/60 px-4 py-3 text-row-strong outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Sheet open={open} onClose={onClose} title={`TP / SL · ${position.asset}`}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-meta font-bold text-muted-foreground">Take profit at</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder={`+ ${coin}`}
              value={profit}
              onChange={(e) => setProfit(e.target.value)}
              className={field}
              aria-label={`Take profit, ${coin} of profit`}
            />
            <span className="shrink-0 text-meta text-muted-foreground">profit</span>
          </span>
          {tpBid !== null ? (
            <span className="text-[0.6875rem] text-muted-foreground">
              Sells when closing pays {zecText(closeValueZat(position.payoutZat, tpBid))} {coin} or more
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-meta font-bold text-muted-foreground">
            Stop if {position.asset} {up ? "falls to" : "rises to"}
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder={spot === null ? "price" : `$${formatPrice(spot)}`}
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            className={field}
            aria-label="Stop price"
          />
          <span className="text-[0.6875rem] text-muted-foreground">
            {trailing && stopPrice === null
              ? "Your trailing stop stays on."
              : trailing
                ? "Replaces your trailing stop."
                : "Sells at the house's bid once the price crosses it."}
          </span>
        </label>
        {problem ? <p className="text-meta text-down">{problem}</p> : null}
        <p className="text-[0.6875rem] text-muted-foreground">
          Close tolerance {slippageBps / (BPS / PERCENT)}% (Settings).
        </p>
        <button
          type="button"
          disabled={busy || problem !== null || !trading}
          onClick={() => void save()}
          className={cx(
            "h-12 w-full rounded-full disabled:opacity-40",
            nothing ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          {busy ? "Saving…" : nothing ? (exit ? "Remove TP / SL" : "Nothing to save") : "Save at the mint"}
        </button>
      </div>
    </Sheet>
  );
}
