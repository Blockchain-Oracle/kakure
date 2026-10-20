"use client";

import { type DeckCard, PRACTICE_WATCH_SEC, type PracticeSide } from "@kakure/arcade";
import { formatUsd, priceDecimals } from "@kakure/chart";
import { type BundleV2, quoteWindow } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { buttonClass, EmptyState, RollingNumber } from "@kakure/ui-web";
import { Hourglass, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { multipleOf } from "@/features/terminal/format";
import { safeStorage } from "@/lib/storage";
import { startBgm, stopBgm } from "../audio";
import { useGames, useImmersive } from "../games-provider";
import { gameKey } from "../keys";
import { DeckSkeleton } from "../stage/deck-skeleton";
import { StageFace } from "../stage/stage-face";
import { type DeckPlace, SwipeDeck } from "../stage/swipe-deck";
import { CardLine } from "./card-line";
import { PRACTICE } from "./copy";
import { DeckStrip, type TileResult } from "./deck-strip";
import { PracticeResult, useReveal } from "./practice-result";
import { PracticeWatch } from "./practice-watch";
import { usePracticeRound } from "./use-practice-round";
import "../stage/stage.css";
import "../stage/stage-art.css";
import "./practice.css";

const SEEN_KEY = gameKey("practiceSeen");
const DEAL_GAP_MS = 90;
const MS = 1000;

/** One asset's live price, reported upward (a hook can't run in a loop; the deck's assets are its children). */
function PriceProbe({ asset, onPrice }: { asset: string; onPrice: (asset: string, price: string) => void }) {
  const live = usePrice(`${asset}-USD` as StreamSymbol);
  useEffect(() => {
    if (live.price) onPrice(asset, live.price);
  }, [asset, live.price, onPrice]);
  return null;
}

function UpPays({
  card,
  bundle,
  spot,
  nowMs,
}: {
  card: DeckCard;
  bundle: BundleV2 | null;
  spot: number | null;
  nowMs: number;
}) {
  if (!bundle) return <span className="st-question-pending">—</span>;
  const sigma = bundle.pricing.sigma[card.asset as keyof typeof bundle.pricing.sigma];
  const quote = quoteWindow(
    { startSec: card.expirySec - card.intervalSec, expirySec: card.expirySec },
    bundle.windows.find((w) => w.id === card.marketId) ?? null,
    { spot, sigma: sigma ? Number(sigma) : null },
    Math.floor(nowMs / MS),
  );
  return quote.up.askE4 === null ? (
    <span className="st-question-pending">—</span>
  ) : (
    <span>{multipleOf(quote.up.askE4)}</span>
  );
}

/**
 * `/games/practice`, Beat the coin (Mitoshi `practice/PracticeStage.tsx`, from Senryo's WarmUpScreen): five live
 * Windows dealt with their sound; each card carries the asset's live line, the rolling price and what Up pays now; after
 * each swipe the coin's pick flips in on the strip; then five races, revealed 220 ms apart, confetti on a win. The frame
 * goes immersive while a round is dealt. Nothing here reads or writes the wallet, and nothing leaves the device.
 */
export function PracticeStage() {
  const session = usePracticeRound();
  const { feedback } = useGames();
  const [seen, setSeen] = useState(true);
  const { readiness, round, score } = session;
  const shown = useReveal(score);
  const dealt = readiness === "ready";
  useImmersive(dealt && (score === null || shown <= score.cards.length));
  useEffect(() => setSeen(safeStorage.getItem(SEEN_KEY) === "1"), []);

  // The deal sounds card by card; the bed plays from the first deal and stops on leaving.
  const dealtSeed = useRef("");
  useEffect(() => {
    if (!round.seed || round.seed === dealtSeed.current) return;
    dealtSeed.current = round.seed;
    startBgm();
    round.cards.forEach((_, i) => {
      window.setTimeout(() => feedback("click"), i * DEAL_GAP_MS);
    });
  }, [round.seed, round.cards, feedback]);
  useEffect(() => () => stopBgm(), []);

  const pick = session.pick;
  const onPick = useCallback(
    (card: DeckCard, side: PracticeSide) => {
      pick(card, side);
      if (!seen) {
        setSeen(true);
        safeStorage.setItem(SEEN_KEY, "1");
      }
    },
    [pick, seen],
  );

  const renderFace = (card: DeckCard, place: DeckPlace) => {
    const price = session.priceOf(card.asset);
    const spot = price ? Number(price) : null;
    return (
      <StageFace
        card={card}
        place={place}
        nowMs={session.nowMs}
        eyebrow={PRACTICE.card.eyebrow(card.asset)}
        question={PRACTICE.card.question}
        line={<CardLine asset={card.asset} />}
        coach={!seen && place.position === 1 ? PRACTICE.card.coach : null}
        clock={{ kind: "watch", sec: PRACTICE_WATCH_SEC }}
        pills={[
          {
            label: PRACTICE.card.live,
            value:
              spot === null ? (
                <span className="st-question-pending">{PRACTICE.card.noPrice}</span>
              ) : (
                <RollingNumber value={formatUsd(spot, priceDecimals(spot))} />
              ),
            tone: "live",
          },
          {
            label: PRACTICE.card.pays,
            value: <UpPays card={card} bundle={session.bundle} spot={spot} nowMs={session.nowMs} />,
            tone: "up",
          },
        ]}
      />
    );
  };

  // Revealed 220 ms apart; a swiped card that never got its close says "No price" instead of a verdict.
  const results: TileResult[] = round.cards.map((_, i) => {
    if (!score || i >= shown) return null;
    const scored = score.cards.find((c) => c.card.index === i);
    return scored ? scored.you : round.picks.some((p) => p.cardIndex === i) ? "unscored" : null;
  });

  return (
    <div className="gm-page pr-stage">
      {session.assets.map((asset) => (
        <PriceProbe key={asset} asset={asset} onPrice={session.reportPrice} />
      ))}
      {dealt ? (
        <>
          <DeckStrip
            seed={round.seed}
            cards={round.cards}
            picks={round.picks}
            active={session.active}
            closesAtMs={session.closesAtMs}
            results={results}
            nowMs={session.nowMs}
          />
          {score ? (
            <PracticeResult round={round} score={score} shown={shown} onAgain={session.deal} />
          ) : round.phase === "watching" ? (
            <PracticeWatch
              round={round}
              leftSec={session.watchLeftSec}
              priceOf={session.priceOf}
              closesAtMs={session.closesAtMs}
            />
          ) : (
            <SwipeDeck
              cards={round.cards}
              active={session.active}
              onPick={onPick}
              refusal={session.active && !session.priceOf(session.active.asset) ? PRACTICE.wait.price : null}
              renderFace={renderFace}
            />
          )}
          <p className="pr-scope">{PRACTICE.scope}</p>
        </>
      ) : readiness === "dealing" ? (
        <>
          <DeckSkeleton />
          <p className="pr-wait" aria-live="polite">
            {PRACTICE.wait.dealing}
          </p>
        </>
      ) : readiness === "no-deck" ? (
        <EmptyState
          icon={<Hourglass />}
          title={PRACTICE.deal.none.title}
          reason={PRACTICE.deal.none.body}
          action={
            <Link href="/games/line-rider" className={buttonClass("secondary", "sm")}>
              {PRACTICE.wait.lineRider}
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon={<RefreshCw />}
          tone="warn"
          title={PRACTICE.deal.offline.title}
          reason={PRACTICE.deal.offline.body}
          action={
            session.retry ? (
              <button type="button" className={buttonClass("secondary", "sm")} onClick={session.retry}>
                {PRACTICE.wait.retry}
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
