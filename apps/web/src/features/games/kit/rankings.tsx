import { Crown, EllipsisIcon } from "lucide-react";
import { PODIUM_PLACES } from "./constants";
import { Marble } from "./marble";

/**
 * The ranked list (Mitoshi `components/ui/leaderboard-rankings.tsx`, from 21st.dev trophyso/leaderboard-rankings):
 * rank · crown for the top three · marble · nickname with its byline · score, your own row highlighted, and your row
 * after an ellipsis when you rank below the list.
 */
export interface RankingRow {
  rank: number;
  name: string;
  byline: string;
  figure: string;
}

const CROWN: Record<number, string> = { 1: "text-vermilion", 2: "text-foreground", 3: "text-muted-foreground" };
const AVATAR_PX = 36;

function Row({ row, mine, youLabel }: { row: RankingRow; mine: boolean; youLabel: string }) {
  return (
    <li
      aria-current={mine ? "true" : undefined}
      className={`flex min-h-11 items-center gap-3 px-4 py-3 ${mine ? "bg-accent-wash shadow-[inset_3px_0_0_var(--vermilion)]" : ""}`}
    >
      <span className="flex w-12 shrink-0 items-center gap-1">
        <span className="numbers w-6 text-right text-body-strong text-foreground">{row.rank}</span>
        {row.rank <= PODIUM_PLACES ? <Crown aria-hidden className={`size-4 ${CROWN[row.rank] ?? ""}`} /> : null}
      </span>
      <span aria-hidden className="shrink-0">
        <Marble seed={row.name} size={AVATAR_PX} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-foreground">
          {row.name}
          {mine ? (
            <span className="ml-2 rounded-full bg-vermilion px-2 py-0.5 text-label-micro text-accent-foreground">
              {youLabel}
            </span>
          ) : null}
        </span>
        {row.byline ? <span className="truncate text-meta text-muted-foreground">{row.byline}</span> : null}
      </span>
      <span className="numbers shrink-0 text-body-strong text-foreground">{row.figure}</span>
    </li>
  );
}

export function Rankings({
  rows,
  you,
  youName,
  label,
  youLabel,
}: {
  rows: readonly RankingRow[];
  /** Your own row, drawn after an ellipsis when it isn't in `rows`. */
  you: RankingRow | null;
  youName: string | null;
  label: string;
  youLabel: string;
}) {
  return (
    <ol
      aria-label={label}
      className="flex flex-col divide-y divide-border overflow-hidden rounded-group border border-border bg-card"
    >
      {rows.map((row) => (
        <Row key={row.name} row={row} mine={youName === row.name} youLabel={youLabel} />
      ))}
      {you ? (
        <>
          <li aria-hidden className="flex justify-center py-1 text-muted-foreground">
            <EllipsisIcon className="size-5" />
          </li>
          <Row row={you} mine youLabel={youLabel} />
        </>
      ) : null}
    </ol>
  );
}
