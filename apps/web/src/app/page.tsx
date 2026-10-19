import { Arcade } from "@/features/landing/arcade";
import { Bento } from "@/features/landing/bento";
import { FinalCall, LandingFooter } from "@/features/landing/final";
import { Hero } from "@/features/landing/hero";
import { How } from "@/features/landing/how";
import { LandingNav } from "@/features/landing/landing-nav";
import { PrivacyMatrix } from "@/features/landing/privacy-matrix";
import { Proof } from "@/features/landing/proof";
import { Stage } from "@/features/landing/stage";
import { Tape } from "@/features/landing/tape";
import "@/features/landing/landing.css";
import "@/features/landing/styles/hero.css";
import "@/features/landing/styles/middle.css";
import "@/features/landing/styles/end.css";

/**
 * The landing (plan §0 R3, Mitoshi's structure): nav, the black-hole hero with the live window, the phones, the live
 * tape, the bento, how it works, who sees what, every close signed, the arcade, the final call and the footer. One
 * dark world in both themes (`kk-dark`). Prerendered; only the live parts hydrate.
 */
export default function Landing() {
  return (
    <div className="lp kk-dark">
      <LandingNav />
      <main id="main">
        <Hero />
        <Tape />
        <Stage />
        <Bento />
        <How />
        <PrivacyMatrix />
        <Proof />
        <Arcade />
        <FinalCall />
      </main>
      <LandingFooter />
    </div>
  );
}
