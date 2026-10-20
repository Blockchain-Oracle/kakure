"use client";

import { BoardsView } from "./boards-view";

/** `/games/rank` (Mitoshi's games rank): the arcade's boards inside the games frame, the strip carrying back and title. */
export function GamesRank() {
  return (
    <div className="gm-page mx-auto w-full max-w-(--layout-reading-max)">
      <BoardsView />
    </div>
  );
}
