"use client";

import { type Network, type Trading, withSlippage } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { bandText, multipleOf, zecText } from "@/features/terminal/format";
import { toast } from "@/features/terminal/toasts";
import { refusalWords } from "@/features/terminal/use-trade";
import { MintError } from "@/features/wallet/api";
import { buyBand } from "@/features/wallet/trading";

/**
 * Buying a band (Range, Moonshot) the way the terminal buys a side: the stake from the terminal's size, the worst ask
 * from its slippage, the mint's refusals in the terminal's words, and Deposit when there are no chips.
 */
export interface BandBuy {
  window: string;
  asset: string;
  lo: string | null;
  hi: string | null;
  side: "in" | "out";
  askE4: number | null;
  stakeZat: number;
  spot: number | null;
}

export function useBandBuy(input: {
  network: Network;
  trading: Trading | null;
  availableZat: number;
  slippageBps: number;
  onNeedChips: () => void;
}): { busy: boolean; buy: (order: BandBuy) => Promise<boolean> } {
  const { network, trading, availableZat, slippageBps, onNeedChips } = input;
  const [busy, setBusy] = useState(false);
  const coin = NETWORK_COIN[network];

  const buy = async (order: BandBuy): Promise<boolean> => {
    if (!trading || busy) return false;
    if (order.askE4 === null) {
      toast({ kind: "info", title: "Not offered right now", description: "This band is all but decided. Move it." });
      return false;
    }
    if (order.stakeZat > availableZat) {
      toast({
        kind: "error",
        title: `Not enough ${coin}`,
        description: `${zecText(order.stakeZat)} ${coin} needed, ${zecText(availableZat)} in chips.`,
        action: { label: "Deposit", run: onNeedChips },
      });
      return false;
    }
    const words = bandText({
      lo: order.lo === null ? null : Number(order.lo),
      hi: order.hi === null ? null : Number(order.hi),
      side: order.side,
    });
    setBusy(true);
    const id = toast({ kind: "loading", title: `Buying ${order.asset} · ${words}…` });
    try {
      const record = await buyBand(network, trading, {
        window: order.window,
        lo: order.lo,
        hi: order.hi,
        side: order.side,
        stakeZat: order.stakeZat,
        maxAskE4: withSlippage(order.askE4, slippageBps, "up"),
        ...(order.spot === null ? {} : { entrySpot: order.spot }),
      });
      fire("send");
      toast({
        id,
        kind: "success",
        title: `${order.asset} · ${words}`,
        description: `pays ${multipleOf(record.certificate?.askE4 ?? order.askE4)} · ${zecText(order.stakeZat)} ${coin} staked`,
      });
      return true;
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
        toast({ id, kind: "error", title: "Order failed", description: error instanceof Error ? error.message : "" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, buy };
}
