import { zatToZec } from "@kakure/domain";
import { router, useFocusEffect } from "expo-router";
import { Clapperboard, Eye, EyeOff, Ticket as TicketIcon, Volume2, VolumeX } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { useMarkets } from "@/data/markets";
import { Pill, Segmented } from "@/kit/controls";
import { Mark } from "@/kit/mark";
import { PressScale } from "@/kit/press";
import { Screen } from "@/kit/screen";
import { EmptyState, Skeleton } from "@/kit/states";
import { Plate } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { formatWhen, useNow } from "@/lib/time";
import { assetFor } from "@/markets/assets";
import { SIDE_SIGN, sideWord, WINDOW_LABEL } from "@/markets/market-view";
import { useNetwork } from "@/network/network-store";
import { positionsOf, totalsOf } from "@/portfolio/money";
import { useSoundLadder, type Voice } from "@/portfolio/sound-ladder";
import { STATUS_LABEL, STATUS_TONE } from "@/portfolio/status";
import { setPrefs, usePrefs } from "@/settings/prefs";
import { useTheme } from "@/theme/theme-provider";
import { useTickets } from "@/tickets/use-tickets";

/**
 * Portfolio (C9, R6; surfaces.md): this phone's tickets only, per network. P&L in ZEC, the privacy eye (amounts not
 * rendered while hidden), open and settled lists, the sound ladder with haptics while a position is open, and the
 * honest replay state until archived price history exists (plan §13.15).
 */
type Tab = "open" | "settled";

export default function Portfolio() {
  const theme = useTheme();
  const network = useNetwork();
  const data = useMarkets();
  const tickets = useTickets(network);
  const now = useNow();
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>("open");
  const [focused, setFocused] = useState(false);
  const [ladder, setLadder] = useState(true);
  const coin = NETWORK_COIN[network];
  const bundle = data.status === "ready" ? data.bundle : null;
  const positions = useMemo(
    () => (Array.isArray(tickets) ? positionsOf(tickets, bundle, now) : []),
    [tickets, bundle, now],
  );
  const totals = totalsOf(positions);
  const shown = positions.filter((position) => position.open === (tab === "open"));
  const openCount = positions.filter((position) => position.open).length;
  const amount = (zat: bigint, signed = false) =>
    prefs.hideAmounts
      ? "Hidden"
      : `${signed && zat > 0n ? "+" : zat < 0n ? "−" : ""}${zatToZec(zat < 0n ? -zat : zat)} ${coin}`;

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const voices: Voice[] = positions.flatMap((position) => {
    if (!position.open || position.ticket.kind !== "close") return [];
    const stream = assetFor({ kind: position.ticket.kind, subject: position.ticket.subject }).stream;
    return stream
      ? [{ key: position.ticket.hash, stream, direction: position.ticket.side === "D" ? "down" : "up" }]
      : [];
  });
  useSoundLadder(voices, focused && ladder && !prefs.hideAmounts);

  const eye = (
    <PressScale
      onPress={() => setPrefs({ hideAmounts: !prefs.hideAmounts })}
      accessibilityLabel={prefs.hideAmounts ? "Show amounts" : "Hide amounts"}
      style={{ padding: theme.space.xs }}
    >
      {prefs.hideAmounts ? (
        <EyeOff color={theme.color.foreground} size={theme.size.icon} />
      ) : (
        <Eye color={theme.color.foreground} size={theme.size.icon} />
      )}
    </PressScale>
  );

  if (tickets === null) {
    return (
      <Screen title="Portfolio" trailing={eye}>
        <Skeleton style={{ height: 140, borderRadius: theme.radius.group }} />
      </Screen>
    );
  }
  if (tickets === "unavailable") {
    return (
      <Screen title="Portfolio" trailing={eye}>
        <EmptyState
          icon={TicketIcon}
          title="The ticket store didn't open"
          reason="Its key lives in this phone's secure storage. Unlock the phone and reopen Kakure."
        />
      </Screen>
    );
  }
  if (tickets.length === 0) {
    return (
      <Screen title="Portfolio" trailing={eye}>
        <EmptyState
          icon={TicketIcon}
          title={`No ${NETWORK_LABEL[network]} tickets on this phone`}
          reason="Tickets you place here stay on this phone only, encrypted. Bet on a market, or import a ticket file in Settings."
          action={{ label: "Browse markets", onPress: () => router.push("/markets") }}
          secondary={{ label: "Import tickets", onPress: () => router.push("/transfer-file?mode=import") }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Portfolio" trailing={eye}>
      <Plate>
        <Txt variant="label" tone="muted">
          Result so far
        </Txt>
        <Txt variant="positionTotal" tone={totals.pnl > 0n ? "up" : totals.pnl < 0n ? "down" : "foreground"}>
          {amount(totals.pnl, true)}
        </Txt>
        <Txt variant="rowDetail" tone="muted">
          {amount(totals.atRisk)} riding on {openCount} open {openCount === 1 ? "ticket" : "tickets"}
          {totals.pending > 0
            ? ` · ${totals.pending} win${totals.pending === 1 ? "" : "s"} waiting for final totals`
            : ""}
        </Txt>
        {voices.length > 0 ? (
          <PressScale
            onPress={() => setLadder(!ladder)}
            accessibilityLabel={ladder ? "Mute the sound ladder" : "Play the sound ladder"}
            style={{ flexDirection: "row", alignItems: "center", gap: theme.space.sm }}
          >
            {ladder ? (
              <Volume2 color={theme.color.foreground} size={theme.size.iconSm} />
            ) : (
              <VolumeX color={theme.color.mutedForeground} size={theme.size.iconSm} />
            )}
            <Txt variant="rowDetail" tone={ladder ? "foreground" : "muted"}>
              {ladder ? "Sound ladder on: hear your open positions move" : "Sound ladder off"}
            </Txt>
          </PressScale>
        ) : null}
      </Plate>

      <Segmented<Tab>
        label="Tickets"
        value={tab}
        onChange={setTab}
        options={[
          { value: "open", label: `Open · ${positions.filter((position) => position.open).length}` },
          { value: "settled", label: `Settled · ${positions.filter((position) => !position.open).length}` },
        ]}
      />

      <View style={{ gap: theme.space.sm }}>
        {shown.length === 0 ? (
          <Txt variant="rowDetail" tone="muted" align="center">
            {tab === "open" ? "No open tickets." : "Nothing settled yet."}
          </Txt>
        ) : null}
        {shown.map(({ ticket, view }) => {
          const asset = assetFor({ kind: ticket.kind, subject: ticket.subject });
          const status =
            ticket.send?.state === "failed" ? "failed" : ticket.send?.state === "sending" ? "sending" : view.status;
          return (
            <PressScale
              key={ticket.hash}
              onPress={() => router.push({ pathname: "/ticket/[hash]", params: { hash: ticket.hash } })}
              accessibilityLabel={`${asset.symbol} ${sideWord(ticket.side)}, ${STATUS_LABEL[status]}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.space.md,
                padding: theme.space.lg,
                borderRadius: theme.radius.group,
                backgroundColor: theme.color.card,
              }}
            >
              <Mark svg={asset.mark} symbol={asset.symbol} size={theme.size.markRow} />
              <View style={{ flex: 1, gap: theme.space.xxs }}>
                <Txt variant="rowTitle">
                  {SIDE_SIGN[ticket.side]} {asset.symbol} {sideWord(ticket.side)} · {amount(BigInt(ticket.sizeZat))}
                </Txt>
                <Txt variant="rowDetail" tone="muted">
                  {WINDOW_LABEL[ticket.window]} · closes {formatWhen(ticket.closesAt, now)}
                </Txt>
              </View>
              <Pill label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} pulse={status === "sending"} />
            </PressScale>
          );
        })}
      </View>

      <Plate>
        <View style={{ flexDirection: "row", gap: theme.space.md, alignItems: "flex-start" }}>
          <Clapperboard color={theme.color.foreground} size={theme.size.icon} />
          <View style={{ flex: 1, gap: theme.space.xs }}>
            <Txt variant="rowTitle">Replay arrives with price history</Txt>
            <Txt variant="rowDetail" tone="muted">
              Replay and Recap films are drawn from the relay's archived one-minute prices, which aren't being recorded
              yet. No film is faked from a guess; they'll appear here, with sound and an MP4 export, once the archive
              exists.
            </Txt>
          </View>
        </View>
      </Plate>
    </Screen>
  );
}
