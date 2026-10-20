"use client";

import { LUCKY_POLICY_VERSION } from "@kakure/arcade";
import { Button } from "@kakure/ui-web";
import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import { copySecret } from "@/lib/clipboard";
import { LUCKY } from "./copy";
import { type LuckyDeal, verifyDeal } from "./use-lucky";

/**
 * The draw's proof (Mitoshi's Proof): the signed bundle it was keyed by, your seed, the candidate Windows and the rule,
 * recomputed here, every value in full. The bundle's hash is the operator's signed `latest.json` entry for that minute,
 * so anyone given these inputs can redo the draw. What it shows is that the draw is exactly what these inputs give and
 * that the Window was unknown before that minute; your browser picks the seed, so it's not a fairness claim against you.
 * Copy puts the inputs on the clipboard as JSON and clears it a minute later, like any secret.
 */
export function LuckyProof({ deal }: { deal: LuckyDeal }) {
  const ok = useMemo(() => verifyDeal(deal), [deal]);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const inputs = {
      policy: LUCKY_POLICY_VERSION,
      network: deal.network,
      bundleSeq: deal.bundleSeq,
      bundleHash: deal.bundleHash,
      seed: deal.seed,
      candidates: deal.candidates.map((c) => c.id),
      candidateHash: deal.candidateHash,
      draw: deal.draw,
    };
    void copySecret(JSON.stringify(inputs, null, 2)).then(() => setCopied(true));
  };
  return (
    <details className="lk-proof">
      <summary>
        <Info aria-hidden className="lk-proof-icon" />
        {LUCKY.proof.open}
        <span className="lk-proof-verdict" data-ok={ok || undefined}>
          {ok ? LUCKY.proof.verified : LUCKY.proof.mismatch}
        </span>
      </summary>
      <dl className="lk-kv">
        <dt>{LUCKY.proof.bundle}</dt>
        <dd>{LUCKY.proof.bundleOf(deal.bundleSeq, deal.bundleHash)}</dd>
        <dt>{LUCKY.proof.seed}</dt>
        <dd>{deal.seed}</dd>
        <dt>{LUCKY.proof.set}</dt>
        <dd>{LUCKY.proof.candidates(deal.candidates.length, deal.candidateHash)}</dd>
      </dl>
      <p className="lk-proof-rule">{LUCKY.proof.rule}</p>
      <p className="lk-proof-rule">{LUCKY.proof.whose}</p>
      <Button variant="quiet" size="sm" onClick={copy}>
        {copied ? LUCKY.proof.copied : LUCKY.proof.copy}
      </Button>
    </details>
  );
}
