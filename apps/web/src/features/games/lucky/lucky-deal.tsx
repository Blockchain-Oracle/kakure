"use client";

import { luckyDrifted } from "@kakure/arcade";
import {
  type BundleV2,
  cadenceLabel,
  type Network,
  parseWindowId,
  quoteWindow,
  type Trading,
  withSlippage,
} from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { SlideToConfirm } from "@kakure/ui-web";
import Link from "next/link";
import { useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { tradeHref } from "@/features/markets/live-lanes";
import { multipleOf, zecText } from "@/features/terminal/format";
import { refusalWords } from "@/features/terminal/use-trade";
import { MintError } from "@/features/wallet/api";
import { buy } from "@/features/wallet/trading";
import { useGames } from "../games-provider";
import { ConfettiBurst } from "../kit/confetti";
import { formatLeft } from "../kit/countdown-ring";
import { MS_PER_SEC } from "./constants";
import { LUCKY } from "./copy";
import { markPlaced } from "./lucky-store";
import type { LuckyDeal as Deal } from "./use-lucky";

const SIDE_CODE = { up: "U", down: "D" } as const;

/**
 * The dealt Window and the lever (Mitoshi `lucky/LuckyDeal.tsx`): the Window the reels landed on, the live quote on the
 * drawn side now (the card places on this, never the snapshot from the deal), and the slide that places the one real
 * trade, from your chips, through the same sealed path as the terminal.
 */
export function LuckyDealCard({
  deal,
  bundle,
  network,
  trading,
  spot,
  nowMs,
  availableZat,
  slippageBps,
  onNeedChips,
  onAgain,
}: {
  deal: Deal;
  bundle: BundleV2;
  network: Network;
  trading: Trading | null;
  spot: number | null;
  nowMs: number;
  availableZat: number;
  slippageBps: number;
  onNeedChips: () => void;
  onAgain: () => void;
}) {
  const { feedback, reducedMotion } = useGames();
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" } | { kind: "failed"; why: string }>({
    kind: "idle",
  });
  const coin = NETWORK_COIN[network];
  const parsed = deal.windowId ? parseWindowId(deal.windowId) : null;
  const nowSec = Math.floor(nowMs / MS_PER_SEC);
  const sigma = bundle.pricing.sigma[deal.draw.asset as keyof typeof bundle.pricing.sigma];
  const quote = parsed
    ? quoteWindow(
        parsed.window,
        bundle.windows.find((w) => w.id === parsed.window.id) ?? null,
        { spot, sigma: sigma ? Number(sigma) : null },
        nowSec,
      )
    : null;
  const ask = quote ? quote[deal.draw.side].askE4 : null;
  const cutoffSec = parsed ? parsed.window.expirySec - bundle.pricing.entryBufferSec : 0;
  const open = parsed !== null && quote?.phase === "live" && nowSec < cutoffSec;
  const drifted = ask !== null && deal.dealtAskE4 !== null && luckyDrifted(deal.dealtAskE4, ask);

  const place = async () => {
    if (!trading || !parsed || ask === null || state.kind === "busy") return;
    if (deal.stakeZat > availableZat) {
      onNeedChips();
      return;
    }
    setState({ kind: "busy" });
    try {
      const record = await buy(network, trading, {
        window: parsed.window.id,
        side: SIDE_CODE[deal.draw.side],
        stakeZat: deal.stakeZat,
        maxAskE4: withSlippage(ask, slippageBps, "up"),
        ...(spot === null ? {} : { entrySpot: spot }),
      });
      markPlaced(deal.seed, record.key);
      fire("send");
      feedback("card-win");
      setState({ kind: "done" });
    } catch (error) {
      fire("error");
      const why =
        error instanceof MintError && error.refused
          ? refusalWords(error, coin).title
          : error instanceof Error
            ? error.message
            : "the order didn't go through";
      setState({ kind: "failed", why });
    }
  };

  return (
    <div className="lk-deal" data-side={deal.draw.side}>
      <ConfettiBurst fire={state.kind === "done"} reduced={reducedMotion} />
      <div className="lk-deal-line">
        <span className="lk-deal-title">
          {LUCKY.deal.window(deal.draw.asset, parsed ? cadenceLabel(parsed.lane.cadenceSec) : "—")}
        </span>
        <span className="lk-deal-side" data-side={deal.draw.side}>
          {LUCKY.side[deal.draw.side]}
        </span>
      </div>
      <p className="lk-deal-quote">
        {!parsed
          ? LUCKY.deal.noQuote
          : !open
            ? LUCKY.deal.gone
            : ask === null
              ? LUCKY.deal.noQuote
              : [
                  LUCKY.deal.pays(multipleOf(ask)),
                  deal.dealtAskE4 ? LUCKY.deal.dealt(multipleOf(deal.dealtAskE4)) : null,
                  LUCKY.deal.closes(formatLeft((parsed.window.expirySec - nowSec) * MS_PER_SEC)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
      </p>
      {drifted && state.kind !== "done" ? <p className="lk-deal-fail">{LUCKY.deal.drifted}</p> : null}
      {state.kind === "done" ? (
        <>
          <p className="lk-deal-done">{LUCKY.placed(`${zecText(deal.stakeZat)} ${coin}`)}</p>
          <div className="lk-deal-actions">
            <button type="button" className="gm-cta" onClick={onAgain}>
              {LUCKY.again}
            </button>
            <Link
              href={tradeHref(deal.draw.asset as Parameters<typeof tradeHref>[0], parsed?.lane.cadenceSec ?? 0)}
              className="gm-cta gm-cta--quiet"
            >
              {LUCKY.deal.window(deal.draw.asset, parsed ? cadenceLabel(parsed.lane.cadenceSec) : "—")}
            </Link>
          </div>
        </>
      ) : !trading ? (
        <p className="lk-deal-fail">{LUCKY.noTrading}</p>
      ) : open && ask !== null ? (
        state.kind === "busy" ? (
          <p className="lk-deal-busy" aria-live="polite">
            {LUCKY.placing}
          </p>
        ) : (
          <SlideToConfirm
            label={LUCKY.lever(`${zecText(deal.stakeZat)} ${coin}`)}
            hint={LUCKY.deal.target(deal.draw.multiplier)}
            onConfirm={() => void place()}
          />
        )
      ) : (
        <button type="button" className="gm-cta" onClick={onAgain}>
          {LUCKY.again}
        </button>
      )}
      {state.kind === "failed" ? <p className="lk-deal-fail">{LUCKY.failed(state.why)}</p> : null}
    </div>
  );
}
