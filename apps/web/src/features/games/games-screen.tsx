import { buttonClass } from "@kakure/ui-web";
import { ArrowRight, Gamepad2 } from "lucide-react";
import Link from "next/link";

/**
 * The games hall (plan §0 Games, §00 T5a): Range and Moonshot are live, priced by the house on the same Windows as the
 * terminal; the arcade modes (Practice, Line Rider, Candle Hop), Lucky and Duel open in R4–R5, so they show what each
 * will be, with no scores, boards or prices until then.
 */
const LIVE: ReadonlyArray<{ name: string; line: string; href: string }> = [
  {
    name: "Range",
    line: "Call where a Window closes: inside a band, or outside it. Tighter pays more.",
    href: "/games/range",
  },
  {
    name: "Moonshot",
    line: "Pick a direction and a reach, ×2 to ×25. The house sets the level.",
    href: "/games/moonshot",
  },
];

const SOON: ReadonlyArray<{ name: string; line: string; stake: string }> = [
  { name: "Practice: Beat the coin", line: "Swipe five live cards and beat a seeded coin.", stake: "Free" },
  { name: "Line Rider", line: "Ride a real one-minute price tape from the signed history.", stake: "Free" },
  { name: "Candle Hop", line: "Hop the same real candles, one at a time.", stake: "Free" },
  {
    name: "Lucky",
    line: "Reels draw a market, a side and a reach on your device, then buy it in a tap with your chips.",
    stake: "Your stake",
  },
  { name: "Duel", line: "Three short calls against another player; picks stay sealed until lock.", stake: "Free" },
];

/** Mode numbers read 01–05. */
const INDEX_DIGITS = 2;

export function GamesScreen() {
  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Games</h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          Range and Moonshot are open, on the same live Windows and private chips as the terminal.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {LIVE.map((mode) => (
          <li key={mode.name}>
            <Link
              href={mode.href}
              className="kk-press flex h-full items-start gap-3 rounded-group border border-border bg-card p-5 outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="font-display text-sheet-heading text-foreground">{mode.name}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-label text-foreground">Live</span>
                </span>
                <span className="text-row-detail text-muted-foreground">{mode.line}</span>
              </span>
              <ArrowRight aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>

      <section
        aria-labelledby="games-coming"
        className="flex flex-col gap-5 rounded-group border border-border bg-card p-5 shadow-[inset_0_0_0_1px_var(--border)] rail:p-6"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-11 place-items-center rounded-full bg-secondary text-vermilion">
            <Gamepad2 className="size-5" />
          </span>
          <div>
            <h2 id="games-coming" className="font-display text-sheet-heading text-foreground">
              The arcade opens next
            </h2>
            <p className="text-row-detail text-muted-foreground">
              Five more modes, all on real prices and signed data.
            </p>
          </div>
        </div>
        <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {SOON.map((mode, i) => (
            <li key={mode.name} className="flex items-start gap-3 rounded-row bg-secondary p-4">
              <span className="numbers pt-0.5 text-money-meta text-muted-foreground">
                {String(i + 1).padStart(INDEX_DIGITS, "0")}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-row-strong text-foreground">{mode.name}</span>
                  <span className="rounded-full px-2 py-0.5 text-label text-muted-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]">
                    {mode.stake}
                  </span>
                </span>
                <span className="text-row-detail text-muted-foreground">{mode.line}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href="/trade" className={buttonClass("primary", "md")}>
          Trade a live Window
        </Link>
        <Link href="/privacy" className={buttonClass("secondary", "md")}>
          How privacy works
        </Link>
      </div>
    </div>
  );
}
