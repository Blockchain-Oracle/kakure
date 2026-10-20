"use client";

import {
  type BundleV2,
  cadenceLabel,
  type LaneAsset,
  type Network,
  parlayWithSlippage,
  type Trading,
} from "@kakure/domain";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { fire } from "@kakure/sounds";
import { Tabs } from "@kakure/ui-web";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { MintError } from "@/features/wallet/api";
import { buyParlay } from "@/features/wallet/trading";
import { clockText, zecText } from "../format";
import { toast } from "../toasts";
import { TradeButtons } from "../ui/trade-buttons";
import { refusalWords } from "../use-trade";
import type { ScreenWindow } from "../use-window";
import { estimateParlay, legLive } from "./estimate";
import { ParlaySlip } from "./parlay-slip";
import { clearSlip, legOf, legOpen, rollSlip, setParlayOn, toggleLeg, useSlip } from "./slip";

/**
 * Parlays on the terminal (Owarine `parlay/useTerminalParlay.tsx`): the slip priced off every leg's live quote, legs
 * moved to the next Window when theirs can no longer join, and one tap to buy the ticket. Bought parlays are positions
 * like any other (the rows mark them at fair value), so this hook only owns the slip.
 */
export interface TerminalParlay {
  /** Parlay mode: UP and DOWN add the Window on screen to the slip. */
  on: boolean;
  legCount: number;
  /** The slip card (the rail on desktop, the sheet on a phone), the Single · Parlay tabs, the phone's slip pill. */
  slip: ReactNode;
  tabs: ReactNode;
  pill: (onOpen: () => void) => ReactNode;
  /** The trade buttons in Parlay mode (add / flip / remove a leg); null in Single mode. */
  buttons: ReactNode | null;
}

export function useTerminalParlay(ctx: {
  network: Network;
  trading: Trading | null;
  bundle: BundleV2 | null;
  screen: ScreenWindow | null;
  asset: LaneAsset;
  spots: ReadonlyMap<StreamSymbol, number>;
  nowSec: number;
  screenStakeZat: number;
  minStakeZat: number;
  availableZat: number;
  slippageBps: number;
  coin: string;
  /** The Window on screen trades now (a leg can be added). */
  canAdd: boolean;
  onNeedChips: () => void;
  onAddMarket: () => void;
  onPlaced: () => void;
}): TerminalParlay {
  const { network, trading, bundle, screen, nowSec, coin } = ctx;
  const slip = useSlip();
  const [busy, setBusy] = useState(false);
  const entryBufferSec = bundle?.pricing.entryBufferSec ?? 0;
  const maxPayoutZat = Number(bundle?.pricing.caps.maxParlayPayoutZat ?? Number.MAX_SAFE_INTEGER);

  // A leg whose Window can no longer join a ticket moves to the next Window of its asset and length.
  useEffect(() => {
    if (!slip.legs.length || !bundle) return;
    for (const l of rollSlip(nowSec, entryBufferSec)) {
      toast({
        kind: "info",
        title: `${l.asset} ${cadenceLabel(l.cadenceSec)} moved to the next Window`,
        description: `Its Window was closing. This leg now closes at ${clockText(l.expirySec)}.`,
      });
    }
  }, [nowSec, slip.legs, bundle, entryBufferSec]);

  const stakeZat = slip.stakeZat ?? ctx.screenStakeZat;
  const live = useMemo(
    () => slip.legs.map((leg) => legLive(leg, bundle, (s) => ctx.spots.get(s) ?? null, nowSec)),
    [slip.legs, bundle, ctx.spots, nowSec],
  );
  const estimate = useMemo(
    () =>
      estimateParlay({
        legs: slip.legs,
        live,
        stakeZat,
        minStakeZat: ctx.minStakeZat,
        maxPayoutZat,
        entryBufferSec,
        nowSec,
        coin,
      }),
    [slip.legs, live, stakeZat, ctx.minStakeZat, maxPayoutZat, entryBufferSec, nowSec, coin],
  );

  const addLeg = (side: "U" | "D") => {
    if (!screen) return;
    const length = cadenceLabel(screen.window.expirySec - screen.window.startSec);
    if (!legOpen(screen.window.expirySec, entryBufferSec, nowSec)) {
      toast({
        kind: "error",
        title: "Closes too soon for a parlay",
        description: `This ${length} Window is nearly done. Add the next one when it opens.`,
      });
      return;
    }
    const cadenceSec = screen.window.expirySec - screen.window.startSec;
    if (toggleLeg(legOf(screen.window, ctx.asset, cadenceSec, side)) === "full") {
      toast({ kind: "error", title: "A parlay holds 3 markets", description: "Remove a leg to add this one." });
      return;
    }
    fire("toggle", { haptic: "tick" });
  };

  const place = async () => {
    if (!estimate.ok || busy || !trading) return;
    const { quote } = estimate;
    if (quote.stakeZat > ctx.availableZat) {
      toast({
        kind: "error",
        title: `Not enough ${coin}`,
        description: `${zecText(quote.stakeZat)} ${coin} needed, ${zecText(ctx.availableZat)} in chips.`,
        action: { label: "Deposit", run: ctx.onNeedChips },
      });
      return;
    }
    setBusy(true);
    const id = toast({ kind: "loading", title: `Placing a ${slip.legs.length}-leg parlay…` });
    try {
      const record = await buyParlay(network, trading, {
        legs: slip.legs.map((l) => ({ window: l.window, side: l.side })),
        stakeZat: quote.stakeZat,
        maxPriceE8: parlayWithSlippage(quote.priceE8, ctx.slippageBps),
      });
      fire("send");
      const payout = Number(record.certificate?.payoutZat ?? quote.payoutZat);
      toast({
        id,
        kind: "success",
        title: "Parlay placed",
        description: `${zecText(payout)} ${coin} if all ${slip.legs.length} land · ${zecText(quote.stakeZat)} ${coin} staked`,
      });
      clearSlip();
      ctx.onPlaced();
    } catch (error) {
      fire("error");
      if (error instanceof MintError && error.refused) toast({ id, kind: "error", ...refusalWords(error, coin) });
      else if (error instanceof MintError)
        toast({
          id,
          kind: "info",
          title: "Waiting for the mint",
          description: "Saved on this device; it finishes when the mint answers.",
        });
      else
        toast({ id, kind: "error", title: "Parlay failed", description: error instanceof Error ? error.message : "" });
    } finally {
      setBusy(false);
    }
  };

  const legHere = screen ? (slip.legs.find((l) => l.window === screen.window.id) ?? null) : null;
  const n = slip.legs.length;
  const multiple = estimate.ok ? estimate.quote.payoutZat / estimate.quote.stakeZat : null;
  return {
    on: slip.on,
    legCount: n,
    slip: (
      <ParlaySlip
        legs={slip.legs}
        live={live}
        estimate={estimate}
        stakeZat={stakeZat}
        ownStake={slip.stakeZat !== null}
        coin={coin}
        nowSec={nowSec}
        entryBufferSec={entryBufferSec}
        busy={busy}
        onPlace={() => void place()}
        onAddMarket={ctx.onAddMarket}
      />
    ),
    tabs: (
      <Tabs
        label="How to trade"
        value={slip.on ? "parlay" : "single"}
        onChange={(v) => {
          fire("toggle", { haptic: "tick" });
          setParlayOn(v === "parlay");
        }}
        items={[
          { value: "single", label: "Single" },
          n > 0 ? { value: "parlay", label: "Parlay", count: n } : { value: "parlay", label: "Parlay" },
        ]}
      />
    ),
    pill: (onOpen) => (
      <button
        type="button"
        onClick={() => {
          fire("toggle", { haptic: "tick" });
          onOpen();
        }}
        className="kk-glass flex h-11 items-center justify-between gap-2 rounded-full px-4 text-meta font-bold"
      >
        <span>{n === 0 ? "Parlay · tap UP or DOWN to add a leg" : `Parlay · ${n} leg${n === 1 ? "" : "s"}`}</span>
        <span className="text-primary">{multiple !== null ? `pays ${multiple.toFixed(2)}× →` : "open →"}</span>
      </button>
    ),
    buttons: slip.on ? (
      <TradeButtons
        mode="flat"
        onUp={() => addLeg("U")}
        onDown={() => addLeg("D")}
        busy={null}
        disabled={!ctx.canAdd}
        why={ctx.canAdd ? null : "This Window has stopped taking trades. The next one opens shortly."}
        picked={legHere?.side ?? null}
        upSub={legHere?.side === "U" ? "in parlay ✓" : "add to parlay"}
        downSub={legHere?.side === "D" ? "in parlay ✓" : "add to parlay"}
      />
    ) : null,
  };
}
