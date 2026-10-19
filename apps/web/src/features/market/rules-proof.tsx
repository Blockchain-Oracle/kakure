"use client";

import type { Bundle, Market } from "@kakure/domain";
import { BatchHistory } from "./batch-history";
import { MarketFacts } from "./market-facts";
import { RulesPanel } from "./rules-panel";

/** The "Rules & proof" sheet's contents, loaded only when the sheet opens (they sit behind one button). */
export default function RulesProof({ market, bundle, now }: { market: Market; bundle: Bundle; now: number }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-foreground">{market.rules.question}</p>
      <MarketFacts market={market} now={now} />
      <RulesPanel market={market} />
      <BatchHistory market={market} bundle={bundle} now={now} />
    </div>
  );
}
