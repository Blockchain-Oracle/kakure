import { buttonClass } from "@kakure/ui-web";
import Link from "next/link";
import { HeroMarket } from "./hero-market";

/**
 * The hero (refero-design-research §3.2, Mercury's split hero; Kawase §10 headline grammar): the claim and one
 * action on the left, a real live market on the right. The words are the promise from plan §1.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto grid w-full max-w-(--layout-content-max) grid-cols-1 items-center gap-10 px-5 pt-8 pb-4 rail:px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] md:pt-16"
    >
      <div className="flex flex-col gap-6">
        <Link
          href="/markets"
          className="flex w-fit items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-chip-label text-secondary-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-up motion-safe:animate-pulse" />
          Live on Zcash testnet
        </Link>
        <h1
          id="hero-title"
          className="font-display text-[clamp(3.1rem,6vw,5.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em] text-foreground"
        >
          Call it. Stay <span className="text-vermilion">hidden</span>.
        </h1>
        <p className="max-w-xl text-body text-muted-foreground">
          Call the close on crypto and Zcash itself with shielded ZEC, from any Zcash wallet, in seconds. The odds are
          public; who placed each bet isn't. No accounts, no tracking. US stocks open once their price feed is
          connected.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/markets" className={buttonClass("primary", "lg")}>
            See the open markets
          </Link>
          <Link href="/privacy" className={buttonClass("secondary", "lg")}>
            How privacy works
          </Link>
        </div>
      </div>
      <HeroMarket />
    </section>
  );
}
