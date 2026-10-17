import { ProofNow } from "./live-panels";
import { Section } from "./sections";

/** Rules and operator proof (refero-design-research §3.8): a live market's own rules and what this page checked. */
export function RulesAndProof() {
  return (
    <Section
      id="rules"
      title="Rules first, then bets"
      lead="Every market's wording, sources, cutoff, refund cases and payout formula are signed before betting opens."
    >
      <ProofNow />
    </Section>
  );
}
