"use client";

import { MAX_ASK_E4, type Network, type Trading, type WindowQuote, withSlippage } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { useCallback, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { MINT_CODES, MintError } from "@/features/wallet/api";
import { armExit, buy, close as closePosition, disarmExit } from "@/features/wallet/trading";
import { BPS } from "./constants";
import { clockText, livePnlText, multipleOf, sideWord, zatToNumber, zecText } from "./format";
import type { LivePosition } from "./positions";
import { toast } from "./toasts";
import type { ScreenWindow } from "./use-window";

/**
 * The terminal's actions (Owarine `useTerminalTrade.ts`): one tap opens at the live ask (within the slippage
 * tolerance), one tap closes at the live bid, and Trail arms a trailing stop at the mint, which fires with this tab
 * closed. Each speaks through a toast that a loading toast turns into, with the open, win or loss sound.
 */
export type Busy = "U" | "D" | "close" | "trail" | null;

const ASSET_FROM_WINDOW = /^([a-z]{3,4})-/;

function assetOfWindow(id: string): string {
  return (ASSET_FROM_WINDOW.exec(id)?.[1] ?? id).toUpperCase();
}

/** A refusal in the terminal's words (Owarine's), or null to say the generic failure. */
function refusalWords(error: MintError, coin: string): { title: string; description: string } {
  switch (error.code) {
    case MINT_CODES.priceMoved:
      return { title: "Price moved", description: "Tap again to take the new price." };
    case MINT_CODES.notOffered:
      return {
        title: "Not offered right now",
        description:
          "This side is all but decided, so the house isn't selling it. Try the other side or another Window.",
      };
    case MINT_CODES.notTrading:
      return { title: "Not trading right now", description: error.message };
    case MINT_CODES.noPrice:
      return { title: "No price right now", description: "The price stream is catching up. Try again in a moment." };
    case MINT_CODES.overCap:
      return { title: "Over the limit", description: error.message };
    case MINT_CODES.alreadySpent:
      return {
        title: "Chips already spent",
        description: `Some chips were spent on another device. Your ${coin} balance is updated.`,
      };
    default:
      return { title: "Order failed", description: error.message };
  }
}

export function useTerminalTrade(input: {
  network: Network;
  trading: Trading | null;
  screen: ScreenWindow | null;
  quote: WindowQuote | null;
  stakeZat: number;
  availableZat: number;
  slippageBps: number;
  /** The live price, kept with a buy for the chart's Entry line. */
  spot: number | null;
  onNeedChips: () => void;
}) {
  const { network, trading, screen, quote, stakeZat, availableZat, slippageBps, spot, onNeedChips } = input;
  const [busy, setBusy] = useState<Busy>(null);
  const coin = NETWORK_COIN[network];

  const open = useCallback(
    async (side: "U" | "D") => {
      if (!trading || !screen || !quote) {
        toast({ kind: "error", title: "No Window open", description: "The next one opens in a moment." });
        return;
      }
      const sym = assetOfWindow(screen.window.id);
      const ask = (side === "U" ? quote.up : quote.down).askE4;
      if (ask === null) {
        const other = (side === "U" ? quote.down : quote.up).askE4;
        toast(
          other === null
            ? { kind: "error", title: "No price right now", description: `Waiting for a live ${sym} price.` }
            : {
                kind: "info",
                title: `${sideWord(side)} isn't offered`,
                description: `It's all but decided: it would pay under ${multipleOf(MAX_ASK_E4)}, the least the house sells.`,
              },
        );
        return;
      }
      if (stakeZat > availableZat) {
        toast({
          kind: "error",
          title: `Not enough ${coin}`,
          description: `${zecText(stakeZat)} ${coin} needed, ${zecText(availableZat)} in chips.`,
          action: { label: "Deposit", run: onNeedChips },
        });
        return;
      }
      setBusy(side);
      const id = toast({ kind: "loading", title: `Buying ${sideWord(side)} ${sym}…` });
      try {
        const record = await buy(network, trading, {
          window: screen.window.id,
          side,
          stakeZat,
          maxAskE4: withSlippage(ask, slippageBps, "up"),
          ...(spot === null ? {} : { entrySpot: spot }),
        });
        fire("send");
        const paid = record.certificate?.askE4 ?? ask;
        toast({
          id,
          kind: "success",
          title: `${sideWord(side)} ${sym} bought`,
          description: `pays ${multipleOf(paid)} · ${zecText(stakeZat)} ${coin} staked`,
        });
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
      } finally {
        setBusy(null);
      }
    },
    [network, trading, screen, quote, stakeZat, availableZat, slippageBps, spot, coin, onNeedChips],
  );

  const close = useCallback(
    async (p: LivePosition) => {
      if (!trading) return;
      const sym = p.asset ?? "";
      if (p.bidE4 === null) {
        toast({
          kind: "info",
          title: "Locked",
          description: `This Window pays at its close (${clockText(p.settlesSec)}).`,
        });
        return;
      }
      setBusy("close");
      const id = toast({ kind: "loading", title: `Closing ${sym}…` });
      try {
        const record = await closePosition(network, trading, p.key, withSlippage(p.bidE4, slippageBps, "down"));
        const pnl = zatToNumber(Number(record.paidZat ?? 0) - p.stakeZat);
        fire(pnl >= 0 ? "win" : "loss");
        toast({
          id,
          kind: pnl >= 0 ? "success" : "info",
          title: `Closed ${sym}`,
          description: `Realized ${livePnlText(pnl)} ${coin}`,
          confetti: pnl > 0,
        });
      } catch (error) {
        fire("error");
        if (error instanceof MintError && error.refused && error.code === MINT_CODES.priceMoved) {
          toast({
            id,
            kind: "error",
            title: "Price moved",
            description: "Close pays less now. Tap again to take the new price.",
          });
        } else if (error instanceof MintError && error.refused)
          toast({ id, kind: "error", ...refusalWords(error, coin) });
        else
          toast({
            id,
            kind: "info",
            title: "Waiting for the mint",
            description: "Saved on this device; it finishes when the mint answers.",
          });
      } finally {
        setBusy(null);
      }
    },
    [network, trading, slippageBps, coin],
  );

  const toggleTrail = useCallback(
    async (p: LivePosition, trailPct: number) => {
      if (!trading) return;
      const sym = p.asset ?? "";
      setBusy("trail");
      try {
        if (p.record.state === "armed") {
          await disarmExit(network, trading, p.key);
          fire("toggle");
          toast({ kind: "info", title: `Trail off · ${sym}` });
        } else {
          await armExit(network, trading, p.key, {
            trail: { bps: Math.max(1, Math.round(trailPct * BPS)), slippageBps },
          });
          fire("confirmed");
          toast({
            kind: "success",
            title: `Trailing · ${sym}`,
            description: "At the mint: it fires even with this tab closed.",
          });
        }
      } catch (error) {
        fire("error");
        if (error instanceof MintError && error.refused) toast({ kind: "error", ...refusalWords(error, coin) });
        else
          toast({
            kind: "info",
            title: "Waiting for the mint",
            description: "Saved on this device; it finishes when the mint answers.",
          });
      } finally {
        setBusy(null);
      }
    },
    [network, trading, slippageBps, coin],
  );

  return { busy, open, close, toggleTrail };
}
