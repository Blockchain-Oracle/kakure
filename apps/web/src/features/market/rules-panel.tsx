import type { Market } from "@kakure/domain";
import type { ReactNode } from "react";

/** The rules fixed before betting opened (D13): wording, resolver, sources, cancellation and payout formula. */
export function RulesPanel({ market }: { market: Market }) {
  const { rules } = market;
  return (
    <section
      className="flex flex-col gap-4 rounded-group border border-border bg-card p-5"
      aria-labelledby="rules-title"
    >
      <h2 id="rules-title" className="font-display text-title text-foreground">
        Rules
      </h2>
      <dl className="flex flex-col gap-4">
        <Rule term="Question">{rules.question}</Rule>
        <Rule term="How it resolves">{rules.resolution}</Rule>
        <Rule term="Sources">
          <ul className="flex flex-col gap-1">
            {rules.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </Rule>
        <Rule term="When everyone is refunded">{rules.cancellation}</Rule>
        <Rule term="Payout">{rules.payoutFormula}</Rule>
        <Rule term="Rules hash">
          <span className="break-all text-row-detail text-muted-foreground tabular-nums">{market.rulesHash}</span>
        </Rule>
      </dl>
    </section>
  );
}

function Rule({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label text-muted-foreground">{term}</dt>
      <dd className="text-body text-foreground">{children}</dd>
    </div>
  );
}
