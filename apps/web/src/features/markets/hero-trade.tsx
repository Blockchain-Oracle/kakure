"use client";

import { type BundleV2, CHIP_GRID_ZAT, type LaneAsset, type Network, type WindowQuote } from "@kakure/domain";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { multipleOf, sideWord } from "@/features/terminal/format";
import { stakeFor, useTradeSettings } from "@/features/terminal/settings";
import { TradeToasts } from "@/features/terminal/toasts";
import { TradeButtons } from "@/features/terminal/ui/trade-buttons";
import { useTerminalTrade } from "@/features/terminal/use-trade";
import { useUpkeep } from "@/features/terminal/use-upkeep";
import type { ScreenWindow } from "@/features/terminal/use-window";
import { whyNotTrading } from "@/features/terminal/why";
import { DepositSheet } from "@/features/wallet/deposit-sheet";
import { useWallet } from "@/features/wallet/wallet-store";
import { tradeHref } from "./live-lanes";

/**
 * The hero's trading half, loaded after the page (the wallet, the relay client and the mint's crypto stay out of the
 * Markets page's first load): UP / DOWN at the house's live price with the terminal's own size, slippage and
 * refusals; a position already on this Window links to the terminal; Deposit opens here when there are no chips. The
 * same upkeep runs as in the terminal, so a position bought here pays out from here.
 */
export default function HeroTrade({
  network,
  bundle,
  asset,
  cadenceSec,
  screen,
  quote,
  spot,
}: {
  network: Network;
  bundle: BundleV2 | null;
  asset: LaneAsset;
  cadenceSec: number;
  screen: ScreenWindow | null;
  quote: WindowQuote | null;
  spot: number | null;
}) {
  const wallet = useWallet(network);
  const settings = useTradeSettings();
  const trading = bundle?.trading ?? null;
  const [depositOpen, setDepositOpen] = useState(false);
  useUpkeep(network, trading, wallet.positions, wallet.status === "ready");
  const minStakeZat = Number(bundle?.pricing.caps.minStakeZat ?? CHIP_GRID_ZAT);
  const maxStakeZat = Number(bundle?.pricing.caps.maxStakeZat ?? Number.MAX_SAFE_INTEGER);
  const stakeZat = Math.min(maxStakeZat, stakeFor(settings, wallet.balanceZat, minStakeZat, CHIP_GRID_ZAT));
  const trade = useTerminalTrade({
    network,
    trading,
    screen,
    quote,
    stakeZat,
    availableZat: wallet.balanceZat,
    slippageBps: settings.slippageBps,
    spot,
    onNeedChips: () => setDepositOpen(true),
  });
  const upAsk = quote?.up.askE4 ?? null;
  const downAsk = quote?.down.askE4 ?? null;
  const why = whyNotTrading({
    phase: screen?.phase ?? null,
    trading: trading !== null,
    vault: wallet.status,
    hasQuote: upAsk !== null || downAsk !== null,
  });
  const mine = screen
    ? wallet.positions.find((p) => p.certificate?.window === screen.window.id && p.state !== "paid")
    : undefined;
  const arriving =
    wallet.deposits.filter((d) => d.state !== "done").sort((a, b) => b.createdAt - a.createdAt)[0]?.key ?? null;

  return (
    <>
      {mine?.certificate?.side ? (
        <Link
          href={tradeHref(asset, cadenceSec)}
          className="flex h-12 items-center justify-between gap-2 rounded-full bg-secondary px-4 text-row-strong text-foreground hover:bg-row-pressed"
        >
          <span>You hold {sideWord(mine.certificate.side)} on this Window</span>
          <span className="flex items-center gap-1 text-meta text-muted-foreground">
            Manage <ArrowRight aria-hidden className="size-4" />
          </span>
        </Link>
      ) : (
        <TradeButtons
          mode="flat"
          onUp={() => void trade.open("U")}
          onDown={() => void trade.open("D")}
          busy={trade.busy}
          disabled={why !== null}
          why={why}
          upSub={upAsk ? `pays ${multipleOf(upAsk)}` : downAsk ? "not offered" : undefined}
          downSub={downAsk ? `pays ${multipleOf(downAsk)}` : upAsk ? "not offered" : undefined}
        />
      )}
      <TradeToasts />
      {trading ? (
        <DepositSheet
          open={depositOpen}
          onClose={() => setDepositOpen(false)}
          network={network}
          trading={trading}
          resume={arriving}
        />
      ) : null}
    </>
  );
}
