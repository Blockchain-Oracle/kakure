import { router, useLocalSearchParams } from "expo-router";
import { Lock, SearchX } from "lucide-react-native";
import { useState } from "react";
import { type LayoutChangeEvent, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMarkets } from "@/data/markets";
import { firstSampleAt, useSamples } from "@/data/price-history";
import { Button } from "@/kit/button";
import { Pill } from "@/kit/controls";
import { LineChart } from "@/kit/line-chart";
import { Mark } from "@/kit/mark";
import { PressScale } from "@/kit/press";
import { EmptyState, Skeleton } from "@/kit/states";
import { Fact, Plate } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { formatClock, formatCountdown, formatDateTime, useNow } from "@/lib/time";
import { assetFor } from "@/markets/assets";
import { LivePrice } from "@/markets/market-card";
import {
  isBettable,
  openingPrice,
  releasedOdds,
  SIDE_SIGN,
  sealedLine,
  sidesOf,
  sideTone,
  sideWord,
  statePill,
  WINDOW_LABEL,
} from "@/markets/market-view";
import { RulesPanel } from "@/markets/rules-panel";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { useTickets } from "@/tickets/use-tickets";

/** Market detail (C1, C5, C6, R7; surfaces.md "Market detail"). */
const CHART_HEIGHT = 160;

function styles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.color.background },
    content: { paddingHorizontal: theme.space.inset, gap: theme.space.lg },
    head: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
    sides: { flexDirection: "row", gap: theme.space.md },
    side: {
      flex: 1,
      height: theme.size.buttonHeight + theme.space.lg,
      borderRadius: theme.radius.group,
      alignItems: "center",
      justifyContent: "center",
      borderBottomWidth: 3,
    },
    oddsRow: { flexDirection: "row", justifyContent: "space-between" },
  });
}

export default function MarketScreen() {
  const theme = useTheme();
  const s = useThemed(styles);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useMarkets();
  const now = useNow();
  const tickets = useTickets(data.network);
  const [chartWidth, setChartWidth] = useState(0);
  const market =
    data.status === "ready" ? (data.bundle.markets.find((candidate) => candidate.id === id) ?? null) : null;
  const asset = market ? assetFor(market) : null;
  const samples = useSamples(asset?.stream ?? null);

  if (data.status === "loading") {
    return (
      <View
        style={[
          s.page,
          { paddingTop: insets.top + theme.space.xxxl, paddingHorizontal: theme.space.inset, gap: theme.space.lg },
        ]}
      >
        <Skeleton style={{ height: 48, width: "60%" }} />
        <Skeleton style={{ height: CHART_HEIGHT, borderRadius: theme.radius.group }} />
        <Skeleton style={{ height: 96, borderRadius: theme.radius.group }} />
      </View>
    );
  }
  if (!market || !asset) {
    return (
      <View style={[s.page, { justifyContent: "center" }]}>
        <EmptyState
          icon={SearchX}
          title="This market isn't in the current batch"
          reason="It may have closed and been archived, or the link is for the other network. Your tickets for it stay in Portfolio."
          action={{ label: "Back to markets", onPress: () => router.replace("/markets") }}
        />
      </View>
    );
  }

  const pill = statePill(market, now);
  const odds = releasedOdds(market);
  const open = isBettable(market, now);
  const reference = openingPrice(market);
  const mine = Array.isArray(tickets) ? tickets.filter((ticket) => ticket.marketId === market.id) : [];
  const since = asset.stream ? firstSampleAt(asset.stream) : null;

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[
        s.content,
        { paddingTop: insets.top + theme.space.xxxl, paddingBottom: insets.bottom + theme.space.xxl },
      ]}
    >
      <View style={s.head}>
        <Mark svg={asset.mark} symbol={asset.symbol} size={theme.size.markDetail} />
        <View style={{ flex: 1, gap: theme.space.xxs }}>
          <Txt variant="title">{asset.name}</Txt>
          <Txt variant="rowDetail" tone="muted">
            {WINDOW_LABEL[market.window]} · closes {formatDateTime(market.closesAt)}
          </Txt>
        </View>
        <Pill label={pill.label} tone={pill.tone} pulse={pill.pulse ?? false} />
      </View>

      <Txt variant="sheetHeading">{market.rules.question}</Txt>

      {asset.stream ? (
        <Plate
          onLayout={(event: LayoutChangeEvent) => setChartWidth(event.nativeEvent.layout.width - theme.space.lg * 2)}
        >
          <View style={s.oddsRow}>
            <LivePrice stream={asset.stream} />
            <Txt variant="meta" tone="text3">
              {reference === null ? "No opening reference" : `Opened at $${reference.toLocaleString("en-US")}`}
            </Txt>
          </View>
          {chartWidth > 0 && samples.length > 1 ? (
            <LineChart samples={samples} width={chartWidth} height={CHART_HEIGHT} reference={reference} />
          ) : (
            <Skeleton style={{ height: CHART_HEIGHT, borderRadius: theme.radius.md }} />
          )}
          <Txt variant="meta" tone="text3">
            {since
              ? `Live since you opened (${formatClock(since)}). Prices relayed from Coinbase.`
              : "Waiting for the first live price…"}
          </Txt>
        </Plate>
      ) : null}

      <Plate>
        {odds ? (
          <>
            <Txt variant="label" tone="muted">
              Odds · batch {odds.seq}
            </Txt>
            {odds.sides.map((side) => (
              <Fact
                key={side.side}
                label={`${side.sign} ${side.word} · ${side.tickets} tickets`}
                value={`${side.percent}% · ${side.multiple ?? "—"}`}
                tone={sideTone(side.side)}
              />
            ))}
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.sm }}>
              <Lock color={theme.color.foreground} size={theme.size.iconSm} />
              <Txt variant="rowStrong">{sealedLine(market)}</Txt>
            </View>
            <Txt variant="rowDetail" tone="muted">
              The count moves only once 3 new tickets arrive, so no single bet can be read from it; the odds open when
              each side has 3.
            </Txt>
          </>
        )}
      </Plate>

      {open ? (
        <>
          <View style={s.sides}>
            {sidesOf(market).map((side) => {
              const up = sideTone(side) === "up";
              return (
                <PressScale
                  key={side}
                  feedback="press"
                  onPress={() => router.push({ pathname: "/bet", params: { id: market.id, side } })}
                  accessibilityLabel={`Bet ${sideWord(side)}`}
                  style={[
                    s.side,
                    {
                      backgroundColor: up ? theme.color.upFill : theme.color.downFill,
                      borderBottomColor: up ? theme.color.upFillEdge : theme.color.downFillEdge,
                    },
                  ]}
                >
                  <Txt variant="buttonLabel" tone="onFill">
                    {SIDE_SIGN[side]} {sideWord(side)}
                  </Txt>
                </PressScale>
              );
            })}
          </View>
          <Txt variant="meta" tone="text3" align="center">
            Betting closes in {formatCountdown(Date.parse(market.cutoffAt) - now)}
          </Txt>
          <Button
            label="Pay from another wallet"
            variant="quiet"
            size="sm"
            onPress={() =>
              router.push({ pathname: "/bet", params: { id: market.id, side: sidesOf(market)[0], external: "1" } })
            }
          />
        </>
      ) : (
        <Plate raised>
          <Txt variant="rowStrong">{pill.label}</Txt>
          <Txt variant="rowDetail" tone="muted">
            {market.state === "scheduled"
              ? `Betting opens ${formatDateTime(market.opensAt)}.`
              : "Betting closed at the cutoff. Tickets mined before the cutoff block count; the outcome follows the rules below."}
          </Txt>
        </Plate>
      )}

      {mine.length > 0 ? (
        <Button
          label={`Your tickets here (${mine.length})`}
          variant="secondary"
          size="md"
          onPress={() => router.push("/portfolio")}
        />
      ) : null}

      <RulesPanel market={market} />
    </ScrollView>
  );
}
