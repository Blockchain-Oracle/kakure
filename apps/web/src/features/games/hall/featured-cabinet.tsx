"use client";

import { type DeckCard, PRACTICE_WATCH_SEC, selectPracticeDeck } from "@kakure/arcade";
import { formatUsd, priceDecimals } from "@kakure/chart";
import { type BundleV2, cadenceLabel, quoteWindow } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import type { RealtimeData } from "@kakure/query";
import { Mark, RollingNumber } from "@kakure/ui-web";
import { Play } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { assetFor } from "@/features/markets/assets";
import { multipleOf } from "@/features/terminal/format";
import { GAMES } from "../copy";
import { useGames } from "../games-provider";
import { CountdownRing } from "../kit/countdown-ring";
import { Sticker } from "../kit/sticker";
import { useLastGame } from "../last-game";
import { practiceCandidates } from "../practice/candidates";

const MS = 1000;

function LiveQuote({ card, bundle, nowSec }: { card: DeckCard; bundle: BundleV2; nowSec: number }) {
  const symbol = `${card.asset}-USD` as StreamSymbol;
  const live = usePrice(symbol);
  const spot = live.price ? Number(live.price) : null;
  const state = bundle.windows.find((w) => w.id === card.marketId) ?? null;
  const sigma = bundle.pricing.sigma[card.asset as keyof typeof bundle.pricing.sigma];
  const quote = quoteWindow(
    { startSec: card.expirySec - card.intervalSec, expirySec: card.expirySec },
    state,
    { spot, sigma: sigma ? Number(sigma) : null },
    nowSec,
  );
  return (
    <div className="hall-feature-quote">
      {spot === null ? (
        <span className="hall-price hall-price--pending">—</span>
      ) : (
        <RollingNumber value={formatUsd(spot, priceDecimals(spot))} className="hall-price" />
      )}
      {quote.up.askE4 === null ? null : (
        <span className="hall-pays">{GAMES.hall.upPays(multipleOf(quote.up.askE4))}</span>
      )}
    </div>
  );
}

/**
 * The hall's featured cabinet (Mitoshi `hall/FeaturedCabinet.tsx`): the next live Window Practice would deal, with its
 * mark and length, a ring to its close, the live price rolling, what Up pays now from the public formula, and a 52 px
 * PLAY. The last game played sits in its corner. Practice itself is free: no chips, nothing sent.
 */
export function FeaturedCabinet({
  bundle,
  status,
  nowMs,
}: {
  bundle: BundleV2 | null;
  status: RealtimeData["status"];
  nowMs: number;
}) {
  const { feedback } = useGames();
  const last = useLastGame();
  const nowSec = Math.floor(nowMs / MS);
  const card = useMemo(
    () => (bundle && nowSec > 0 ? (selectPracticeDeck(practiceCandidates(bundle, nowSec), nowSec)[0] ?? null) : null),
    [bundle, nowSec],
  );
  const state =
    status === "error"
      ? GAMES.hall.offline
      : status === "unpublished"
        ? GAMES.hall.unpublished
        : bundle === null
          ? GAMES.hall.reading
          : card === null
            ? GAMES.hall.noWindow
            : null;
  const info = card ? assetFor({ kind: "close", subject: card.asset }) : null;

  return (
    <section className="hall-feature" aria-label={GAMES.hall.featured}>
      <span className="hall-lights" aria-hidden />
      <div className="hall-feature-top">
        <Sticker tone="up" tilt={-4}>
          {GAMES.econ.none}
        </Sticker>
        <span className="hall-feature-eyebrow">{GAMES.hall.featured}</span>
        {last ? (
          <Link href={last.href} className="hall-continue" onClick={() => feedback("tap")}>
            {GAMES.hall.continueTo(last.name)}
          </Link>
        ) : null}
      </div>

      {card && info && bundle ? (
        <>
          <div className="hall-feature-body">
            <Mark mark={info.mark} label={card.asset} size="detail" />
            <div className="hall-feature-id">
              <span className="hall-feature-asset">{card.asset}</span>
              <span className="hall-feature-cadence">
                {GAMES.hall.cadence(cadenceLabel(card.intervalSec))} · {PRACTICE_WATCH_SEC} s calls
              </span>
            </div>
            <CountdownRing
              startMs={(card.expirySec - card.intervalSec) * MS}
              endMs={card.expirySec * MS}
              size="lg"
              glow
            />
          </div>
          <LiveQuote card={card} bundle={bundle} nowSec={nowSec} />
        </>
      ) : (
        <p className="hall-feature-state">{state}</p>
      )}

      <Link href="/games/practice" className="gm-cta hall-play" data-press onClick={() => feedback("tap")}>
        <Play aria-hidden className="hall-play-icon" />
        {GAMES.hall.play}
      </Link>
    </section>
  );
}
