"use client";

import type { DuelMatchView, DuelState } from "@kakure/arcade";
import { Mark } from "@kakure/ui-web";
import { Lock, Share2 } from "lucide-react";
import type { CSSProperties } from "react";
import { SITE_ORIGIN } from "@/constants";
import { assetFor } from "@/features/markets/assets";
import { renderShareCard, saveCard } from "@/features/terminal/share/card";
import { SearchingBanner } from "../art/pixel-art";
import { ConfettiBurst } from "../kit/confetti";
import { formatLeft } from "../kit/countdown-ring";
import { Marble } from "../kit/marble";
import { DUEL } from "./copy";

/**
 * The Duel's screens around the swipe (Mitoshi `duel/DuelParts.tsx`, from Owarine): the queue's breathing search
 * plate, the versus (two marbles entering from their sides), the sealed wait and the result (each card with both
 * calls and its outcome, unfolding 600 ms apart).
 */
const MS = 1000;
const PORTRAIT_PX = 72;
const QUEUE_PORTRAIT_PX = 40;

export function DuelQueue({
  state,
  nickname,
  onLeave,
}: {
  state: Extract<DuelState, { status: "waiting" }>;
  nickname: string;
  onLeave: () => void;
}) {
  return (
    <section className="du-queue" aria-label={DUEL.queue.title} aria-live="polite">
      <div className="du-searching du-breathe" aria-hidden>
        <SearchingBanner className="du-searching-art" />
        <span className="du-queue-me">
          <Marble seed={nickname} size={QUEUE_PORTRAIT_PX} className="du-portrait" />
          <span className="du-queue-name">{nickname}</span>
        </span>
        <span className="du-dots">
          <span />
          <span />
          <span />
        </span>
      </div>
      <h2 className="du-title">{DUEL.queue.title}</h2>
      <p className="du-note">
        {DUEL.queue.waited(Math.max(0, state.waitedSec))} · {DUEL.queue.band}
      </p>
      <button type="button" className="du-ghost" onClick={onLeave}>
        {DUEL.queue.leave}
      </button>
    </section>
  );
}

function Seat({ label, name, rating }: { label: string; name: string; rating: number }) {
  return (
    <div className="du-seat">
      <Marble seed={name} size={PORTRAIT_PX} className="du-portrait" />
      <span className="du-seat-label">{label}</span>
      <span className="du-seat-name">{name}</span>
      <span className="du-seat-note">{DUEL.lobby.rating(rating)}</span>
    </div>
  );
}

export function Versus({ match, seat }: { match: DuelMatchView; seat: 0 | 1 }) {
  const me = match.seats[seat];
  const them = match.seats[seat === 0 ? 1 : 0];
  return (
    <div className="du-versus">
      <Seat label={DUEL.lobby.you} name={me.nickname} rating={me.rating} />
      <span className="du-vs" aria-hidden>
        {DUEL.lobby.vs}
      </span>
      <Seat label={DUEL.lobby.opponent} name={them.nickname} rating={them.rating} />
    </div>
  );
}

/** Waiting with the calls sealed: the deck face down and why nobody can read them yet. */
export function SealedWait({ match, revealing }: { match: DuelMatchView; revealing: boolean }) {
  return (
    <section className="du-sealed" aria-live="polite">
      <ol className="du-deck" aria-label={DUEL.sealed.title}>
        {match.deck.map((card) => (
          <li key={card.window} className="du-deck-card du-deck-card--sealed">
            <Lock aria-hidden className="du-deck-lock" />
            {card.asset}
          </li>
        ))}
      </ol>
      <h2 className="du-title">{DUEL.sealed.title}</h2>
      <p className="du-note">
        {revealing
          ? DUEL.sealed.revealing
          : `${DUEL.sealed.waiting}${match.pickLeftSec !== null ? ` · ${match.pickLeftSec}s` : ""}`}
      </p>
      <p className="du-note du-note--quiet">{DUEL.sealed.note}</p>
    </section>
  );
}

export function DuelResult({
  match,
  seat,
  nowMs,
  reduced,
  onAgain,
}: {
  match: DuelMatchView;
  seat: 0 | 1;
  nowMs: number;
  reduced: boolean;
  onAgain: () => void;
}) {
  const them = seat === 0 ? 1 : 0;
  const me = match.seats[seat];
  const other = match.seats[them];
  const decided = match.outcomes.filter((o) => o === "U" || o === "D").length;
  const done = match.status === "final" || match.status === "forfeit" || match.status === "void";
  const verdict =
    match.status === "void"
      ? DUEL.result.void
      : match.status === "forfeit"
        ? match.winner === seat
          ? DUEL.result.forfeitWon
          : DUEL.result.forfeitLost
        : match.status === "final"
          ? match.winner === null
            ? DUEL.result.tie
            : match.winner === seat
              ? DUEL.result.won
              : DUEL.result.lost
          : DUEL.result.waiting;
  return (
    <section className="du-result" aria-label={verdict}>
      <ConfettiBurst fire={done && match.winner === seat} reduced={reduced} />
      <div className="du-totals">
        <div className="du-total">
          <span className="du-seat-label">{DUEL.result.you}</span>
          <span className="du-total-figure">{me.right}</span>
          {me.delta !== null ? <span className="du-total-delta">{DUEL.result.delta(me.delta)}</span> : null}
        </div>
        <span className="du-vs" aria-hidden>
          {DUEL.lobby.vs}
        </span>
        <div className="du-total">
          <span className="du-seat-label">{other.nickname}</span>
          <span className="du-total-figure">{other.right}</span>
          {other.delta !== null ? <span className="du-total-delta">{DUEL.result.delta(other.delta)}</span> : null}
        </div>
      </div>
      <p className="du-verdict" data-final={done || undefined}>
        {verdict}
        {decided > 0 && !done ? ` · ${DUEL.result.right(me.right, decided)}` : ""}
      </p>
      <ol className="du-rows">
        {match.deck.map((card, i) => {
          const outcome = match.outcomes[i] ?? null;
          const mine = me.picks?.[i] ?? null;
          const theirs = other.picks?.[i] ?? null;
          const leftMs = card.expirySec * MS - nowMs;
          return (
            <li key={card.window} className="du-row" style={{ "--i": i } as CSSProperties}>
              <Mark mark={assetFor({ kind: "close", subject: card.asset }).mark} label={card.asset} size="inline" />
              <span className="du-row-asset">{card.asset}</span>
              <span
                className="du-row-side"
                data-side={mine ?? undefined}
                data-right={outcome && mine ? (mine === "up") === (outcome === "U") : undefined}
              >
                {mine ? DUEL.result.side[mine] : DUEL.result.none}
              </span>
              <span className="du-row-side" data-side={theirs ?? undefined}>
                {theirs ? DUEL.result.side[theirs] : DUEL.result.none}
              </span>
              <span className="du-row-outcome" data-outcome={outcome ?? undefined}>
                {outcome
                  ? DUEL.result.outcome[outcome]
                  : leftMs > 0
                    ? DUEL.result.settlesIn(formatLeft(leftMs))
                    : DUEL.result.none}
              </span>
            </li>
          );
        })}
      </ol>
      {done ? (
        <div className="du-actions">
          <button type="button" className="gm-cta du-cta" onClick={onAgain}>
            {DUEL.result.again}
          </button>
          {match.status === "void" ? null : (
            <button
              type="button"
              className="gm-cta gm-cta--quiet du-cta"
              onClick={() => shareDuel(match, seat, verdict)}
            >
              <Share2 aria-hidden className="du-share-icon" /> {DUEL.share.label}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The verdict as a share card (plan §0 R7): the opponent's nickname, the right calls each and the day, with a link to
 * the Duel. A duel's result is public by nickname already; the card adds nothing about anyone's money.
 */
function shareDuel(match: DuelMatchView, seat: 0 | 1, verdict: string) {
  const me = match.seats[seat];
  const other = match.seats[seat === 0 ? 1 : 0];
  void renderShareCard({
    call: DUEL.share.call(other.nickname),
    score: DUEL.share.score(me.right, other.right),
    when: new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }),
    url: `${SITE_ORIGIN}/games/duel`,
    foot: DUEL.share.foot(verdict),
  }).then((blob) => saveCard(blob, `kakure-duel-${other.nickname}.png`));
}
