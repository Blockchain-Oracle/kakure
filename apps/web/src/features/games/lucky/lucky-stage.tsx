"use client";

import { useCallback, useEffect, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { useRealtime } from "@/features/data/use-realtime";
import { zecText } from "@/features/terminal/format";
import { useTradeSettings } from "@/features/terminal/settings";
import { TradeToasts } from "@/features/terminal/toasts";
import { useUpkeep } from "@/features/terminal/use-upkeep";
import { LANE_SYMBOLS, useCommittedSpots } from "@/features/terminal/use-window";
import { DepositSheet } from "@/features/wallet/deposit-sheet";
import { useWallet } from "@/features/wallet/wallet-store";
import { useNow } from "@/lib/time";
import { startBgm, stopBgm } from "../audio";
import { useGames, useImmersive } from "../games-provider";
import { LUCKY_STAKES_ZAT } from "./constants";
import { LUCKY } from "./copy";
import { LuckyDealCard } from "./lucky-deal";
import { LuckyFloor, useLuckyRecord } from "./lucky-floor";
import { LuckyProof } from "./lucky-proof";
import { LuckyReels } from "./lucky-reels";
import { reelSpin } from "./reel-sfx";
import { useLucky } from "./use-lucky";
import "./lucky.css";

/**
 * `/games/lucky`, the machine (Mitoshi `lucky/LuckyStage.tsx`, Owarine's cabinet, Senryo's "Lucky becomes a machine"):
 * three reels land on a live asset, a side and a reach; the stake is one of four chips from the ladder; SPIN draws on
 * this device; the deal card shows the live quote and the lever places the one real trade from your chips. The proof
 * sits behind Proof, recomputed here, and your draws stay on this device.
 */
export function LuckyStage() {
  const data = useRealtime();
  const network = data.network;
  const bundle = data.status === "ready" ? data.bundle : null;
  const latest = data.status === "ready" ? data.latest : null;
  const trading = bundle?.trading ?? null;
  const wallet = useWallet(network);
  const settings = useTradeSettings();
  const spots = useCommittedSpots(LANE_SYMBOLS);
  const nowMs = useNow();
  const { feedback } = useGames();
  const coin = NETWORK_COIN[network];
  const [chip, setChip] = useState(0);
  const [depositOpen, setDepositOpen] = useState(false);
  useUpkeep(network, trading, wallet.positions, wallet.status === "ready");
  const spotOf = useCallback((asset: string) => spots.get(`${asset}-USD` as never) ?? null, [spots]);
  const lucky = useLucky({ network, bundle, latest, spotOf });
  const record = useLuckyRecord(network, wallet.positions);
  const busy = lucky.phase === "spinning" || lucky.phase === "landing";
  useImmersive(lucky.phase === "spinning" || lucky.phase === "landing" || lucky.phase === "dealt");
  useEffect(() => () => stopBgm(), []);

  const stakeZat = LUCKY_STAKES_ZAT[chip] ?? LUCKY_STAKES_ZAT[0];
  const spin = () => {
    feedback("tap");
    startBgm();
    reelSpin();
    lucky.spin(stakeZat);
  };
  const target = lucky.deal && lucky.phase !== "spinning" ? lucky.deal.draw : null;

  return (
    <div className="gm-page lk-stage">
      <section className="lk-cabinet" aria-label={LUCKY.title}>
        <span className="lk-lights" aria-hidden />
        <LuckyReels
          cycling={lucky.phase === "spinning"}
          landing={lucky.phase === "landing"}
          held={lucky.phase === "dealt"}
          target={target}
          onLanded={lucky.landed}
        />
      </section>

      {lucky.phase === "dealt" && lucky.deal && bundle ? (
        <LuckyDealCard
          deal={lucky.deal}
          bundle={bundle}
          network={network}
          trading={trading}
          spot={spotOf(lucky.deal.draw.asset)}
          nowMs={nowMs}
          availableZat={wallet.balanceZat}
          slippageBps={settings.slippageBps}
          onNeedChips={() => setDepositOpen(true)}
          onAgain={lucky.reset}
        />
      ) : (
        <>
          <div className="lk-chips" role="radiogroup" aria-label={LUCKY.stake}>
            {LUCKY_STAKES_ZAT.map((zat, i) => (
              // biome-ignore lint/a11y/useSemanticElements: chips styled as a radio group, Mitoshi's stake chips
              <button
                key={zat}
                type="button"
                role="radio"
                aria-checked={chip === i}
                className="lk-chip"
                disabled={busy}
                onClick={() => setChip(i)}
              >
                {zecText(zat)} {coin}
              </button>
            ))}
          </div>
          <button type="button" className="gm-cta lk-cta" disabled={busy || !lucky.ready} onClick={spin}>
            {busy ? LUCKY.spinning : lucky.phase === "empty" ? LUCKY.again : LUCKY.spin}
          </button>
          {record.best > 0 ? <p className="lk-note lk-streak">{LUCKY.streak(record.streak, record.best)}</p> : null}
          {lucky.phase === "empty" ? <p className="lk-note">{LUCKY.noWindows}</p> : null}
          <p className="lk-note">{LUCKY.privacy}</p>
        </>
      )}

      {lucky.deal && lucky.phase === "dealt" ? <LuckyProof deal={lucky.deal} /> : null}
      <LuckyFloor network={network} positions={wallet.positions} />
      <TradeToasts />
      {trading ? (
        <DepositSheet
          open={depositOpen}
          onClose={() => setDepositOpen(false)}
          network={network}
          trading={trading}
          resume={
            wallet.deposits.filter((d) => d.state !== "done").sort((a, b) => b.createdAt - a.createdAt)[0]?.key ?? null
          }
        />
      ) : null}
    </div>
  );
}
