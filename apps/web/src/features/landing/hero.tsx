import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { HeroLive } from "./hero-live";
import { START, WORDS } from "./words";

/**
 * The first screen (plan §0 R3; Mitoshi's hero, mitoshi-code-study §7): the "live on" chip, the silver headline with
 * its one vermilion word, the line and two actions, over the black hole that is the product's own metaphor. The copy
 * is a server component; the hole, the batch heartbeat and the live window hydrate around it.
 */
export function Hero() {
  const { hero } = WORDS;
  return (
    <HeroLive
      copy={
        <>
          <Link href="/markets" className="lp-chip">
            <span className="lp-live-dot" aria-hidden />
            {hero.kicker}
          </Link>
          <h1 id="lp-h1" className="lp-h1">
            <span>{hero.title[0]}</span>
            <span>
              {hero.title[1]} <em>{hero.accent}</em>
            </span>
          </h1>
          <p className="lp-line">{hero.line}</p>
          <div className="lp-ctas">
            <Link href={START} className="lp-btn lp-btn--accent lp-btn--lg">
              {hero.start} <ArrowRight aria-hidden />
            </Link>
            <Link href="/privacy" className="lp-btn lp-btn--glass lp-btn--lg">
              <ShieldCheck aria-hidden /> {hero.privacy}
            </Link>
          </div>
        </>
      }
    />
  );
}
