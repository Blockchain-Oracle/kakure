"use client";

import { type ArcadeGame, BOARD_LIMIT } from "@kakure/arcade";
import type { BundleV2 } from "@kakure/domain";
import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useCallback, useRef, useState } from "react";
import { AttractCanvas } from "../arcade/attract-canvas";
import { ARCADE } from "../arcade/copy";
import { GameScene } from "../art/scenes";
import { CABINET_ORDER, type GameId, gameEntry } from "../catalog";
import { GAMES } from "../copy";
import { useGames } from "../games-provider";
import { ECON_TONE } from "../games-rail";
import { Sticker } from "../kit/sticker";
import { useNickname } from "../player/player-store";
import { useAttractTape, useBoard, useStanding } from "../player/queries";
import { practiceCandidates, windowsLive } from "../practice/candidates";

const MS = 1000;
const isArcade = (id: GameId): id is ArcadeGame => id === "line-rider" || id === "candle-hop";

function ArcadeFact({ game }: { game: ArcadeGame }) {
  const board = useBoard(game, "all", BOARD_LIMIT);
  const standing = useStanding(game);
  const nickname = useNickname();
  if (board.isError) return <span className="cab-fact">{GAMES.card.boardOffline}</span>;
  const top = board.data?.rows[0];
  if (!board.data) return <span className="cab-fact">…</span>;
  if (!top) return <span className="cab-fact">{GAMES.card.noRuns}</span>;
  const mine = nickname && standing.data?.best != null ? ARCADE.fmt(standing.data.best) : null;
  return <span className="cab-fact">{GAMES.card.top(ARCADE.fmt(top.score), mine)}</span>;
}

function Cabinet({ id, fact }: { id: GameId; fact: ReactNode }) {
  const { feedback, reducedMotion } = useGames();
  const tape = useAttractTape();
  const entry = gameEntry(id);
  return (
    <li className="cab" data-off={entry.open ? undefined : ""}>
      <span className="cab-lights" aria-hidden />
      <div className="cab-screen">
        {isArcade(id) && !reducedMotion ? <AttractCanvas game={id} tape={tape} /> : <GameScene game={id} />}
      </div>
      <div className="cab-foot">
        <div className="cab-id">
          <span className="cab-name">{entry.name}</span>
          <Sticker tone={ECON_TONE[entry.economicKind]} title={entry.economicLabel}>
            {GAMES.econ[entry.economicKind]}
          </Sticker>
        </div>
        {fact}
        {entry.open ? (
          <Link href={entry.href} className="gm-cta cab-play" data-press onClick={() => feedback("tap")}>
            {GAMES.card.play}
          </Link>
        ) : (
          <span className="cab-soon">{GAMES.card.soon}</span>
        )}
      </div>
    </li>
  );
}

/**
 * The cabinet rail (Mitoshi `hall/CabinetRail.tsx`, after Senryo's "every game as a card that shows the game itself"):
 * snap-scrolling with the next cabinet peeking on phones, a 2/3/4-column grid from 768/1024/1440. Each cabinet: the
 * scene (the arcade ones play themselves on a real tape), the pixel name, whose money is at risk, one live fact and a
 * 44 px Play; a mode not open yet says what it opens as.
 */
export function CabinetRail({ bundle, nowMs }: { bundle: BundleV2 | null; nowMs: number }) {
  const nowSec = Math.floor(nowMs / MS);
  const live = bundle && nowSec > 0 ? windowsLive(practiceCandidates(bundle, nowSec), nowSec) : null;
  const windowsFact = <span className="cab-fact">{live === null ? "…" : GAMES.card.windowsLive(live)}</span>;
  // 21st.dev ddoemonn/snap-carousel's affordances on a native snap rail: dots, ←/→/Home/End, the position announced.
  const rail = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const goTo = useCallback((i: number) => {
    const el = rail.current;
    const child = el?.children[Math.max(0, Math.min(CABINET_ORDER.length - 1, i))] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: "smooth" });
  }, []);
  const onScroll = () => {
    const el = rail.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    const step = first.offsetWidth + Number.parseFloat(getComputedStyle(el).columnGap || "0");
    setIndex(Math.round(el.scrollLeft / Math.max(1, step)));
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: CABINET_ORDER.length - 1,
    };
    const to = keys[e.key];
    if (to === undefined || e.target !== e.currentTarget) return;
    e.preventDefault();
    goTo(to);
  };

  const factOf = (id: GameId): ReactNode => {
    if (isArcade(id)) return <ArcadeFact game={id} />;
    if (id === "lucky" || id === "duel") return <span className="cab-fact">{GAMES.card.soonLine[id]}</span>;
    return windowsFact;
  };

  return (
    <div className="cab-wrap">
      <ul
        ref={rail}
        className="cab-rail"
        aria-label={GAMES.title}
        aria-roledescription="carousel"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the rail scrolls by keyboard (←/→/Home/End)
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKey}
      >
        {CABINET_ORDER.map((id) => (
          <Cabinet key={id} id={id} fact={factOf(id)} />
        ))}
      </ul>
      <div className="cab-dots">
        {CABINET_ORDER.map((id, i) => (
          <button
            key={id}
            type="button"
            className="cab-dot"
            aria-label={GAMES.card.goTo(i + 1, CABINET_ORDER.length)}
            aria-current={i === index || undefined}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {GAMES.card.goTo(index + 1, CABINET_ORDER.length)}
      </span>
    </div>
  );
}
