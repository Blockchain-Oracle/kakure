import type { Market } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Pill } from "@/kit/controls";
import { Mark } from "@/kit/mark";
import { PressScale } from "@/kit/press";
import { Txt } from "@/kit/text";
import { formatCountdown } from "@/lib/time";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { assetFor } from "./assets";
import { isBettable, releasedOdds, sealedLine, shortTitle, statePill } from "./market-view";

/** A market card (surfaces.md Markets): mark, title, live spot, countdown, state pill, odds bar or "Sealed · n". */
function styles(theme: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.color.card,
      borderRadius: theme.radius.group,
      padding: theme.space.lg,
      gap: theme.space.md,
    },
    head: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
    title: { flex: 1, gap: theme.space.xxs },
    foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.sm },
    bar: {
      flexDirection: "row",
      height: theme.space.sm,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
      backgroundColor: theme.color.secondary,
    },
  });
}

const PRICE_DIGITS = 2;
const SMALL_PRICE = 10;
const SMALL_DIGITS = 4;

export function formatUsd(price: string | undefined): string {
  const value = Number(price);
  if (!Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value < SMALL_PRICE ? SMALL_DIGITS : PRICE_DIGITS,
    maximumFractionDigits: value < SMALL_PRICE ? SMALL_DIGITS : PRICE_DIGITS,
  })}`;
}

export function LivePrice({ stream }: { stream: StreamSymbol }) {
  const price = usePrice(stream);
  return (
    <Txt
      variant="rowPrice"
      tone={price.status === "live" ? "foreground" : "muted"}
      accessibilityLabel={`${stream} ${price.status}`}
    >
      {price.status === "connecting" ? "Connecting…" : formatUsd(price.price)}
      {price.status === "stale" ? " · stale" : ""}
    </Txt>
  );
}

export function MarketCard({ market, now }: { market: Market; now: number }) {
  const theme = useTheme();
  const s = useThemed(styles);
  const asset = assetFor(market);
  const pill = statePill(market, now);
  const odds = releasedOdds(market);
  const open = isBettable(market, now);
  const cutoff = Date.parse(market.cutoffAt);

  return (
    <PressScale
      onPress={() => router.push({ pathname: "/market/[id]", params: { id: market.id } })}
      accessibilityLabel={`${shortTitle(market, asset.symbol)}, ${pill.label}`}
      style={s.card}
    >
      <View style={s.head}>
        <Mark svg={asset.mark} symbol={asset.symbol} size={theme.size.markRow} />
        <View style={s.title}>
          <Txt variant="rowTitle" numberOfLines={2}>
            {shortTitle(market, asset.symbol)}
          </Txt>
          <Txt variant="rowDetail" tone="muted">
            {asset.name}
          </Txt>
        </View>
        {asset.stream ? <LivePrice stream={asset.stream} /> : null}
      </View>
      {odds ? (
        <View style={s.bar} accessibilityLabel={`${odds.sides[0].word} ${odds.sides[0].percent} percent`}>
          <View style={{ flex: Math.max(1, odds.sides[0].percent), backgroundColor: theme.color.upFill }} />
          <View style={{ flex: Math.max(1, odds.sides[1].percent), backgroundColor: theme.color.downFill }} />
        </View>
      ) : null}
      <View style={s.foot}>
        <Pill label={pill.label} tone={pill.tone} pulse={pill.pulse ?? false} />
        <Txt variant="moneyMeta" tone="muted">
          {odds
            ? `${odds.sides[0].sign} ${odds.sides[0].percent}% · ${odds.sides[1].sign} ${odds.sides[1].percent}%`
            : market.state === "scheduled"
              ? "Not open yet"
              : sealedLine(market)}
        </Txt>
      </View>
      {open ? (
        <Txt variant="moneyMeta" tone="text3">
          Betting closes in {formatCountdown(cutoff - now)}
        </Txt>
      ) : null}
    </PressScale>
  );
}
