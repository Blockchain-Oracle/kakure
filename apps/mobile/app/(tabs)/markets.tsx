import type { Market } from "@kakure/domain";
import { bundleLateBy, type DataError } from "@kakure/query";
import { router } from "expo-router";
import { CalendarClock, QrCode, Radio } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { CLOSING_SOON_MS, NETWORK_LABEL } from "@/constants";
import { useMarkets } from "@/data/markets";
import { Segmented } from "@/kit/controls";
import { PressScale } from "@/kit/press";
import { Screen } from "@/kit/screen";
import { EmptyState, ErrorState, Skeleton, StaleTick, Strip } from "@/kit/states";
import { Txt } from "@/kit/text";
import { formatAge, useNow } from "@/lib/time";
import { assetFor, type Category } from "@/markets/assets";
import { MarketCard } from "@/markets/market-card";
import { isBettable } from "@/markets/market-view";
import { useSwitchNetwork } from "@/network/flood";
import { useTheme } from "@/theme/theme-provider";

/**
 * Markets (C1, surfaces.md): the signed bundle's markets for the active network, by tab, with live relay prices,
 * countdowns and honest sealed/stale states. Every visitor loads the same files (PD14).
 */
const TABS: { value: Category; label: string }[] = [
  { value: "crypto", label: "Crypto" },
  { value: "stocks", label: "Stocks" },
  { value: "zcash", label: "Zcash" },
];

const ORDER: Record<Market["state"], number> = {
  open: 0,
  closing: 0,
  scheduled: 1,
  closed: 2,
  resolving: 3,
  resolved: 4,
  refunding: 4,
  paid: 5,
};

export function dataErrorCopy(error: DataError, network: string): { title: string; reason: string } {
  switch (error.kind) {
    case "offline":
      return {
        title: "You're offline",
        reason: "Markets load from the signed files once you're back online. Anything already loaded stays on screen.",
      };
    case "key-not-pinned":
      return {
        title: `No ${network} markets in this build`,
        reason: `This build has no operator key for ${network}, so it shows nothing it can't verify. Testnet markets are live.`,
      };
    case "signature":
    case "mismatch":
    case "format":
      return {
        title: "Data didn't verify",
        reason: "The published files didn't match the pinned operator key, so nothing is shown. Try again later.",
      };
    default:
      return {
        title: "Markets didn't load",
        reason: "The data host didn't answer. Check the connection and try again.",
      };
  }
}

export default function Markets() {
  const theme = useTheme();
  const data = useMarkets();
  const now = useNow();
  const switchNetwork = useSwitchNetwork();
  const [tab, setTab] = useState<Category>("crypto");

  const markets = useMemo(() => (data.status === "ready" ? data.bundle.markets : []), [data]);
  const shown = useMemo(
    () =>
      markets
        .filter((market) => assetFor(market).category === tab)
        .sort(
          (left, right) =>
            ORDER[left.state] - ORDER[right.state] || Date.parse(left.cutoffAt) - Date.parse(right.cutoffAt),
        ),
    [markets, tab],
  );
  const closingSoon = shown.filter(
    (market) => isBettable(market, now) && Date.parse(market.cutoffAt) - now < CLOSING_SOON_MS,
  );
  const rest = shown.filter((market) => !closingSoon.includes(market));

  const scan = (
    <PressScale
      onPress={() => router.push("/scan")}
      accessibilityLabel="Scan a market link"
      style={{ padding: theme.space.xs }}
    >
      <QrCode color={theme.color.foreground} size={theme.size.icon} strokeWidth={theme.size.iconStroke} />
    </PressScale>
  );

  return (
    <Screen
      title="Markets"
      trailing={scan}
      refreshing={data.status === "ready" && data.isFetching}
      onRefresh={data.status === "loading" ? undefined : () => data.refetch()}
    >
      <Segmented label="Market type" value={tab} onChange={setTab} options={TABS} />

      {data.status === "loading" ? (
        <View style={{ gap: theme.space.md }}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} style={{ height: 132, borderRadius: theme.radius.group }} />
          ))}
        </View>
      ) : data.status === "unpublished" ? (
        <EmptyState
          icon={CalendarClock}
          title="No markets published yet"
          reason={`The ${NETWORK_LABEL[data.network]} operator hasn't published its first signed bundle. It checks again every minute.`}
          action={{ label: "Check now", onPress: data.refetch }}
        />
      ) : data.status === "error" ? (
        (() => {
          const copy = dataErrorCopy(data.error, NETWORK_LABEL[data.network]);
          return data.error.kind === "key-not-pinned" ? (
            <EmptyState
              icon={Radio}
              title={copy.title}
              reason={copy.reason}
              action={{ label: "Switch to Testnet", onPress: () => switchNetwork("testnet") }}
            />
          ) : (
            <ErrorState title={copy.title} reason={copy.reason} onRetry={data.refetch} />
          );
        })()
      ) : (
        <>
          {data.refreshError ? <StaleTick since={data.checkedAt} now={now} label="Couldn't refresh" /> : null}
          {bundleLateBy(data.latest, now) > 0 ? (
            <Strip>{`The next signed batch is ${formatAge(bundleLateBy(data.latest, now))} late. These odds are from batch ${data.latest.seq}.`}</Strip>
          ) : null}
          {shown.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={`No ${TABS.find((item) => item.value === tab)?.label.toLowerCase()} markets right now`}
              reason="Markets open on a fixed schedule. Try another tab, or check back at the top of the hour."
            />
          ) : null}
          {closingSoon.length > 0 ? (
            <View style={{ gap: theme.space.md }}>
              <Txt variant="label" tone="text3">
                Closing soon
              </Txt>
              {closingSoon.map((market) => (
                <MarketCard key={market.id} market={market} now={now} />
              ))}
            </View>
          ) : null}
          {rest.length > 0 ? (
            <View style={{ gap: theme.space.md }}>
              {closingSoon.length > 0 ? (
                <Txt variant="label" tone="text3">
                  Later
                </Txt>
              ) : null}
              {rest.map((market) => (
                <MarketCard key={market.id} market={market} now={now} />
              ))}
            </View>
          ) : null}
          <Txt variant="meta" tone="text3" align="center">
            Signed batch {data.latest.seq} · checked {formatAge(now - data.checkedAt)} ago
          </Txt>
        </>
      )}
    </Screen>
  );
}
