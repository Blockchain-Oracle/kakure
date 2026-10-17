import { GetStarted, LandingFooter } from "@/features/landing/get-started";
import { Hero } from "@/features/landing/hero";
import { LandingHeader } from "@/features/landing/landing-header";
import { LifecycleNow } from "@/features/landing/live-panels";
import { MarketTape } from "@/features/landing/market-tape";
import { RulesAndProof } from "@/features/landing/rules-section";
import { Lifecycle, PlaceABet, PortfolioAndReceipts, WhoSeesWhat } from "@/features/landing/sections";

/**
 * The landing (refero-design-research §3, surfaces.md): hero with a live market, the live tape, betting in three
 * steps, who sees what, the sealed-odds lifecycle, portfolio and receipts, rules and proof, then docs, download and
 * the footer with the operator keys. Prerendered; only the live parts hydrate.
 */
export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <LandingHeader />
      <main id="main" className="flex flex-col gap-16">
        <Hero />
        <MarketTape />
        <PlaceABet />
        <WhoSeesWhat />
        <Lifecycle now={<LifecycleNow />} />
        <PortfolioAndReceipts />
        <RulesAndProof />
        <GetStarted />
      </main>
      <LandingFooter />
    </div>
  );
}
