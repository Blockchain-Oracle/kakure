"use client";

import type { DeckCard, PracticeSide } from "@kakure/arcade";
import { cadenceLabel } from "@kakure/domain";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence, motion, type PanInfo, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CardBack } from "../art/pixel-art";
import {
  BEHIND_RISE_PX,
  BEHIND_SCALE,
  COMMIT_TRAVEL_PX,
  COMMIT_VELOCITY,
  DRAG_ELASTIC,
  DRAG_MAX_ROTATE_DEG,
  ENTER,
  FALLBACK_CARD_PX,
  FLY_ROTATE_DEG,
  LOCKED_HINT_MS,
  REDUCED_EXIT_SEC,
  SETTLE_SPRING,
  STAMP_AT_PX,
  THROW_DISTANCE_PX,
  THROW_SEC,
} from "../constants";
import { useGames } from "../games-provider";
import { STAGE } from "./copy";
import "./stage.css";
import "./stage-art.css";

/**
 * The deck as a gesture (Mitoshi `stage/SwipeDeck.tsx`, Flicky's swipe screen): one card at a time, thrown up for UP
 * and down for DOWN. The face is a slot (Practice and the Duel are the same motion over different faces); the two calls
 * are always drawn and always enough (keyboard and pointer), so turning motion off loses nothing; and a refusal holds
 * the card with its reason instead of letting it fly at something that would refuse it.
 */
export interface SideOdds {
  pct: number | null;
  locked: boolean;
}

export interface DeckPlace {
  position: number;
  total: number;
}

export interface SwipeDeckProps {
  cards: readonly DeckCard[];
  active: DeckCard | null;
  onPick: (card: DeckCard, side: PracticeSide) => void;
  busy?: boolean;
  refusal?: string | null;
  odds?: { up: SideOdds; down: SideOdds } | null;
  renderFace: (card: DeckCard, place: DeckPlace) => ReactNode;
}

/** Flicky's throw: the card leaves opaque, spinning off past the tilt it was dragged to. */
const FULL = {
  enter: ENTER,
  in: { opacity: 1, scale: 1, y: 0, rotate: 0 },
  out: (side: PracticeSide | null) => ({
    opacity: 1,
    y: side === "up" ? -THROW_DISTANCE_PX : side === "down" ? THROW_DISTANCE_PX : 0,
    rotate: side === "up" ? -FLY_ROTATE_DEG : side === "down" ? FLY_ROTATE_DEG : 0,
    transition: { duration: THROW_SEC, ease: "easeOut" as const },
  }),
};
/** Reduced motion keeps every state change and drops the movement: the card swaps, it doesn't fly. */
const REDUCED = {
  enter: { opacity: 1 },
  in: { opacity: 1 },
  out: { opacity: 0, transition: { duration: REDUCED_EXIT_SEC } },
};
const NO_ODDS: SideOdds = { pct: null, locked: false };
/** The cards drawn behind the top one. */
const BEHIND_CARDS = 2;

export function SwipeDeck({
  cards,
  active,
  onPick,
  busy = false,
  refusal = null,
  odds = null,
  renderFace,
}: SwipeDeckProps) {
  const { reducedMotion, feedback } = useGames();
  const [thrown, setThrown] = useState<PracticeSide | null>(null);
  const [lockedHint, setLockedHint] = useState<PracticeSide | null>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const held = busy || refusal !== null;
  const draggable = active !== null && !held && !reducedMotion;
  const sideOdds = { up: odds?.up ?? NO_ODDS, down: odds?.down ?? NO_ODDS };

  // One motion value drives the tilt, the tints, the stamp and the next card rising, on the compositor with the finger.
  const y = useMotionValue(0);
  const rotate = useTransform(y, (v) => {
    const half = (deckRef.current?.offsetHeight || FALLBACK_CARD_PX) / 2;
    return Math.max(-DRAG_MAX_ROTATE_DEG, Math.min(DRAG_MAX_ROTATE_DEG, -(v / half) * DRAG_MAX_ROTATE_DEG));
  });
  const progress = useTransform(y, (v) => Math.min(1, Math.abs(v) / COMMIT_TRAVEL_PX));
  const upTint = useTransform(y, (v) => (v < 0 ? Math.min(1, -v / COMMIT_TRAVEL_PX) : 0));
  const downTint = useTransform(y, (v) => (v > 0 ? Math.min(1, v / COMMIT_TRAVEL_PX) : 0));
  const nextY = useTransform(progress, (p) => BEHIND_RISE_PX * (1 - p));
  const nextScale = useTransform(progress, (p) => BEHIND_SCALE + (1 - BEHIND_SCALE) * p);
  const [leaning, setLeaning] = useState<PracticeSide | null>(null);
  // The value can change while a card mounts (inside motion's render), so the stamp's state lands just after it.
  const leaningNow = useRef<PracticeSide | null>(null);
  useMotionValueEvent(y, "change", (v) => {
    const next = v < -STAMP_AT_PX ? "up" : v > STAMP_AT_PX ? "down" : null;
    if (next === leaningNow.current) return;
    leaningNow.current = next;
    queueMicrotask(() => setLeaning(leaningNow.current));
  });

  useEffect(() => {
    if (!lockedHint) return;
    const timer = setTimeout(() => setLockedHint(null), LOCKED_HINT_MS);
    return () => clearTimeout(timer);
  }, [lockedHint]);
  // A new card has its own sides.
  useEffect(() => setLockedHint(null), [active]);

  const commit = useCallback(
    (side: PracticeSide) => {
      if (!active || held) {
        feedback("deny");
        return;
      }
      if (side === "up" ? sideOdds.up.locked : sideOdds.down.locked) {
        feedback("deny");
        setLockedHint(side);
        return;
      }
      feedback(side === "up" ? "swipe-up" : "swipe-down");
      // Whether to hand focus onward is decided here, while the played card still holds it.
      refocus.current = document.activeElement !== null && deckRef.current?.contains(document.activeElement) === true;
      setThrown(side);
      onPick(active, side);
    },
    [active, held, onPick, feedback, sideOdds.up.locked, sideOdds.down.locked],
  );

  const onDragEnd = useCallback(
    (_event: unknown, info: PanInfo) => {
      const up = info.offset.y <= -COMMIT_TRAVEL_PX || info.velocity.y <= -COMMIT_VELOCITY;
      const down = info.offset.y >= COMMIT_TRAVEL_PX || info.velocity.y >= COMMIT_VELOCITY;
      if (up && !down) commit("up");
      else if (down && !up) commit("down");
    },
    [commit],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        commit(event.key === "ArrowUp" ? "up" : "down");
      }
    },
    [commit],
  );

  // A card played from the keyboard hands focus to the next one (found by index: both are mounted mid-throw).
  useEffect(() => {
    if (!refocus.current || !active) return;
    refocus.current = false;
    deckRef.current?.querySelector<HTMLElement>(`[data-card="${active.index}"]`)?.focus();
  }, [active]);

  const position = active ? cards.findIndex((card) => card.index === active.index) : cards.length;
  const behind = active ? cards.slice(position + 1, position + 1 + BEHIND_CARDS) : [];
  const place: DeckPlace = { position: Math.min(position + 1, cards.length), total: cards.length };

  return (
    <div className="st-stage">
      <p className="sr-only">{STAGE.cardOf(place.position, place.total)}</p>
      <div className="st-deck" ref={deckRef}>
        {behind.map((card, depth) =>
          depth === 0 ? (
            <motion.div
              key={card.index}
              className="st-card st-card--behind st-card--back"
              style={{ "--st-depth": 1, y: nextY, scale: nextScale } as never}
              aria-hidden
            >
              <CardBack className="st-back-art" />
            </motion.div>
          ) : (
            <div
              key={card.index}
              className="st-card st-card--behind st-card--back"
              style={{ "--st-depth": depth + 1 } as CSSProperties}
              aria-hidden
            >
              <CardBack className="st-back-art" />
            </div>
          ),
        )}

        <AnimatePresence initial={false} custom={thrown} mode="popLayout">
          {active ? (
            <motion.div
              key={active.index}
              data-card={active.index}
              className={`st-card st-card--active${held ? " st-card--held" : ""}`}
              data-swipe={leaning ?? "idle"}
              style={reducedMotion ? {} : { y, rotate }}
              variants={reducedMotion ? REDUCED : FULL}
              custom={thrown}
              initial="enter"
              animate="in"
              exit="out"
              transition={SETTLE_SPRING}
              drag={draggable ? "y" : false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={DRAG_ELASTIC}
              dragSnapToOrigin
              onDragEnd={onDragEnd}
              tabIndex={0}
              role="group"
              aria-label={STAGE.cardLabel(active.asset, cadenceLabel(active.intervalSec))}
              onKeyDown={onKeyDown}
            >
              {renderFace(active, place)}
              {reducedMotion ? null : (
                <>
                  <motion.span className="st-tint st-tint--up" style={{ opacity: upTint }} aria-hidden />
                  <motion.span className="st-tint st-tint--down" style={{ opacity: downTint }} aria-hidden />
                </>
              )}
              {leaning ? (
                <span className={`st-stamp st-stamp--${leaning}`} aria-hidden>
                  {leaning === "up" ? STAGE.up : STAGE.down}
                </span>
              ) : null}
            </motion.div>
          ) : (
            <div className="st-empty" key="empty">
              <p className="st-empty-title">{STAGE.empty.title}</p>
              <p className="st-empty-body">{STAGE.empty.body}</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      <span className="sr-only" aria-live="polite">
        {active ? STAGE.announce(place.position, place.total, active.asset, cadenceLabel(active.intervalSec)) : ""}
      </span>
      {refusal ? <p className="st-refusal">{refusal}</p> : null}
      <div className="st-actions">
        <Call side="up" odds={sideOdds.up} disabled={!active || held} onClick={() => commit("up")} />
        <Call side="down" odds={sideOdds.down} disabled={!active || held} onClick={() => commit("down")} />
      </div>
      <p className={`st-hint${lockedHint ? " st-hint--locked" : ""}`}>
        {lockedHint ? STAGE.hintLocked(lockedHint) : held && refusal ? STAGE.hintHeld : STAGE.hint}
      </p>
    </div>
  );
}

function Call({
  side,
  odds,
  disabled,
  onClick,
}: {
  side: PracticeSide;
  odds: SideOdds;
  disabled: boolean;
  onClick: () => void;
}) {
  const Arrow = side === "up" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      className={`st-call st-call--${side}`}
      data-locked={odds.locked || undefined}
      disabled={disabled}
      aria-disabled={odds.locked || undefined}
      title={odds.locked ? STAGE.hintLocked(side) : undefined}
      onClick={onClick}
    >
      <Arrow aria-hidden />
      <span className="st-call-word">{side === "up" ? STAGE.up : STAGE.down}</span>
      {odds.pct !== null || odds.locked ? (
        <span className="st-call-odds">{odds.locked ? STAGE.locked : `${odds.pct}%`}</span>
      ) : null}
    </button>
  );
}
