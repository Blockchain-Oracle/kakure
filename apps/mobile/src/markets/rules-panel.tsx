import type { Market } from "@kakure/domain";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { PressScale } from "@/kit/press";
import { Fact, Plate, Rule } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { formatDateTime } from "@/lib/time";
import { useTheme } from "@/theme/theme-provider";

/**
 * The market's rules exactly as signed before betting opened (D13): wording, resolution, sources, cancellation and
 * the payout formula, with the rules hash so anyone can check it. Detail behind one disclosure (kawase.md §4.8).
 */
const HASH_PREVIEW = 16;

export function RulesPanel({ market }: { market: Market }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <Plate>
      <PressScale
        onPress={() => setOpen(!open)}
        accessibilityLabel={open ? "Hide the rules" : "Show the rules"}
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Txt variant="rowTitle">Rules</Txt>
          <Chevron color={theme.color.mutedForeground} size={theme.size.railIcon} />
        </View>
      </PressScale>
      <Fact label="Betting closes" value={formatDateTime(market.cutoffAt)} />
      <Fact label="Closes" value={formatDateTime(market.closesAt)} />
      {open ? (
        <View style={{ gap: theme.space.md }}>
          <Rule />
          <Txt variant="label" tone="muted">
            Resolution
          </Txt>
          <Txt variant="rowDetail">{market.rules.resolution}</Txt>
          <Txt variant="label" tone="muted">
            Sources
          </Txt>
          {market.rules.sources.map((source) => (
            <Txt key={source} variant="rowDetail">
              {source}
            </Txt>
          ))}
          {market.opening ? (
            <>
              <Txt variant="label" tone="muted">
                Opening reference
              </Txt>
              {Object.entries(market.opening).map(([venue, price]) => (
                <Fact key={venue} label={venue} value={price} />
              ))}
            </>
          ) : null}
          <Txt variant="label" tone="muted">
            Cancellation and refunds
          </Txt>
          <Txt variant="rowDetail">{market.rules.cancellation}</Txt>
          <Txt variant="label" tone="muted">
            Payout
          </Txt>
          <Txt variant="rowDetail">{market.rules.payoutFormula}</Txt>
          {market.cutoffHeight ? <Fact label="Cutoff block" value={String(market.cutoffHeight)} /> : null}
          <Fact label="Rules hash" value={`${market.rulesHash.slice(0, HASH_PREVIEW)}…`} />
        </View>
      ) : null}
    </Plate>
  );
}
