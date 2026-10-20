import { Crown } from "lucide-react";
import { PODIUM_PLACES } from "./constants";
import { Marble } from "./marble";

/**
 * The top three (Mitoshi `components/ui/leaderboard-podium.tsx`, from 21st.dev trophyso/leaderboard-podium): the
 * 2 · 1 · 3 order, a crown over each place, the marble ring and stepped plinths. Every name is a nickname.
 */
export interface PodiumPlace {
  rank: number;
  name: string;
  figure: string;
}

const PLINTH: Record<number, string> = {
  1: "h-28 border-vermilion/40 bg-vermilion/20",
  2: "h-20 border-border bg-secondary",
  3: "h-14 border-border bg-secondary",
};
const CROWN: Record<number, string> = { 1: "text-vermilion", 2: "text-foreground", 3: "text-muted-foreground" };
const COLUMN: Record<number, string> = { 1: "col-start-2", 2: "col-start-1", 3: "col-start-3" };
const AVATAR_PX = 56;

export function Podium({ places, label }: { places: readonly PodiumPlace[]; label: string }) {
  const top = places.filter((p) => p.rank <= PODIUM_PLACES);
  if (top.length === 0) return null;
  return (
    <ol aria-label={label} className="grid grid-cols-3 items-end gap-2 sm:gap-4">
      {top.map((p) => (
        <li key={p.name} className={`flex min-w-0 flex-col items-center gap-2 row-start-1 ${COLUMN[p.rank] ?? ""}`}>
          <Crown aria-hidden className={`size-5 ${CROWN[p.rank] ?? ""}`} />
          <span
            aria-hidden
            className={`grid place-items-center rounded-full ring-2 ${p.rank === 1 ? "ring-vermilion" : "ring-border"}`}
          >
            <Marble seed={p.name} size={AVATAR_PX} />
          </span>
          <span className="max-w-full truncate text-meta text-foreground">{p.name}</span>
          <span className="numbers text-body-strong text-foreground">{p.figure}</span>
          <span
            aria-hidden
            className={`numbers flex w-full items-start justify-center rounded-t-md border pt-2 text-title text-foreground ${PLINTH[p.rank] ?? ""}`}
          >
            {p.rank}
          </span>
        </li>
      ))}
    </ol>
  );
}
