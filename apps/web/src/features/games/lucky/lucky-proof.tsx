"use client";

import { Info } from "lucide-react";
import { useMemo } from "react";
import { HASH_EDGE } from "./constants";
import { LUCKY } from "./copy";
import { type LuckyDeal, verifyDeal } from "./use-lucky";

const cut = (hex: string) => (hex.length > HASH_EDGE * 2 ? `${hex.slice(0, HASH_EDGE)}…${hex.slice(-HASH_EDGE)}` : hex);

/**
 * The draw's proof (Mitoshi's Proof): the signed bundle it was keyed by, your seed, the candidate Windows and the rule,
 * recomputed here. The bundle's hash is the operator's signed `latest.json` entry for that minute, so anyone holding
 * the seed can redo the draw.
 */
export function LuckyProof({ deal }: { deal: LuckyDeal }) {
  const ok = useMemo(() => verifyDeal(deal), [deal]);
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
        <dd>{LUCKY.proof.bundleOf(deal.bundleSeq, cut(deal.bundleHash))}</dd>
        <dt>{LUCKY.proof.seed}</dt>
        <dd>{cut(deal.seed)}</dd>
        <dt>{LUCKY.proof.set}</dt>
        <dd>{LUCKY.proof.candidates(deal.candidates.length, cut(deal.candidateHash))}</dd>
      </dl>
      <p className="lk-proof-rule">{LUCKY.proof.rule}</p>
    </details>
  );
}
