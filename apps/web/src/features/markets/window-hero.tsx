"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { type BundleV2, CHIP_GRID_ZAT, cadenceLabel, type LaneAsset, type Network } from "@kakure/domain";
import { cx, Mark } from "@kakure/ui-web";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LiveWindowChart } from "@/features/chart/live-window-chart";
import { multipleOf, sideWord, windowStatus } from "@/features/terminal/format";
import { stakeFor, useTradeSettings } from "@/features/terminal/settings";
import { TradeButtons } from "@/features/terminal/ui/trade-buttons";
import { useTerminalTrade } from "@/features/terminal/use-trade";
import { pickWindow, useQuote } from "@/features/terminal/use-window";
import { whyNotTrading } from "@/features/terminal/why";
import { useWallet } from "@/features/wallet/wallet-store";
import { assetFor } from "./assets";
import { tradeHref } from "./live-lanes";

/**
 * The Markets hero (Mitoshi's hero, mitoshi-code-study §3.1; plan §00 "the shortest Window open now"): the Window as a
 * live picture (from the open to the close, the Line it has to beat, the price rolling in), where it stands, and UP /
 * DOWN at the house's live price, bought right here with the terminal's own size, slippage and refusals. A position
 * on this Window is managed in the terminal, one tap away.
 */
const PERCENT = 100;
const CHANGE_DECIMALS = 2;
const MS = 1000;

export function WindowHero({
  network,
  bundle,
  asset,
  cadenceSec,
  spot,
  nowSec,
  onNeedChips,
}: {
  network: Network;
  bundle: BundleV2 | null;
  asset: LaneAsset;
  cadenceSec: number;
  spot: number | null;
  nowSec: number;
  onNeedChips: () => void;
}) {
  const info = assetFor({ kind: "close", subject: asset });
  const wallet = useWallet(network);
  const settings = useTradeSettings();
  const trading = bundle?.trading ?? null;
  const held = new Set(wallet.positions.flatMap((p) => (p.certificate?.window ? [p.certificate.window] : [])));
  const screen = nowSec > 0 ? pickWindow(asset, cadenceSec, bundle, nowSec, held) : null;
  const sigmaText = bundle?.pricing.sigma[asset];
  const quote = useQuote(screen, spot, sigmaText ? Number(sigmaText) : null, nowSec);
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
    onNeedChips,
  });

  const line = screen?.state?.reference ? Number(screen.state.reference) : null;
  const away = spot !== null && line !== null && line > 0 ? ((spot - line) / line) * PERCENT : null;
  const entryBufferSec = bundle?.pricing.entryBufferSec ?? 0;
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
  const href = tradeHref(asset, cadenceSec);

  return (
    <article
      aria-label={`${info.name} ${cadenceLabel(cadenceSec)} Window`}
      className="flex flex-col gap-4 rounded-group border border-border bg-card p-4 md:p-5"
    >
      <header className="flex items-center gap-3">
        <Mark mark={info.mark} label={asset} size="token" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-title text-foreground">
            {asset} · {cadenceLabel(cadenceSec)} Window
          </h2>
          <p className="numbers text-meta text-muted-foreground">
            {windowStatus({
              phase: screen?.phase ?? null,
              startSec: screen?.window.startSec ?? null,
              cutoffSec: screen ? screen.window.expirySec - entryBufferSec : null,
              expirySec: screen?.window.expirySec ?? null,
              nowSec,
            })}
            {line !== null ? ` · Line ${formatUsd(line, priceDecimals(line))}` : ""}
          </p>
        </div>
        <Link
          href={href}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3.5 text-chip-label text-foreground hover:bg-row-pressed"
        >
          Terminal <ArrowRight aria-hidden className="size-4" />
        </Link>
      </header>

      <div className="flex items-baseline justify-between gap-3">
        <span className="numbers font-display text-page-title text-foreground">
          {spot === null ? "—" : formatUsd(spot, priceDecimals(spot))}
        </span>
        <span
          className={cx(
            "numbers text-row-strong",
            away === null ? "text-muted-foreground" : away >= 0 ? "text-up" : "text-down",
          )}
        >
          {away === null
            ? "Line sets at the open"
            : `${away >= 0 ? "▲" : "▼"} ${Math.abs(away).toFixed(CHANGE_DECIMALS)}% vs the Line`}
        </span>
      </div>

      {screen ? (
        <LiveWindowChart
          symbol={`${asset}-USD`}
          spec={{
            opensAt: screen.window.startSec * MS,
            closesAt: screen.window.expirySec * MS,
            reference: line,
            referenceLabel: "Line",
          }}
          className="h-56 w-full md:h-64"
          label={`${info.name} price over this ${cadenceLabel(cadenceSec)} Window`}
        />
      ) : (
        <div className="h-56 rounded-row bg-secondary md:h-64" />
      )}

      {mine?.certificate?.side ? (
        <Link
          href={href}
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
    </article>
  );
}
