import { type Side, TICKET_SIZES_ZAT } from "@kakure/domain";
import { winningPayout } from "@kakure/query";
import { router, useLocalSearchParams } from "expo-router";
import { SearchX } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { BetProgress } from "@/bet/bet-progress";
import { prepareExternalTicket } from "@/bet/external";
import { canPay, placeBet } from "@/bet/place-bet";
import { NETWORK_COIN } from "@/constants";
import { useMarkets } from "@/data/markets";
import { Button } from "@/kit/button";
import { Chips, Segmented } from "@/kit/controls";
import { SheetBody } from "@/kit/screen";
import { SlideToConfirm } from "@/kit/slide-to-confirm";
import { EmptyState, Strip } from "@/kit/states";
import { Fact, Plate } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { useNow } from "@/lib/time";
import { assetFor } from "@/markets/assets";
import { coinAmount, isBettable, SIDE_SIGN, sidesOf, sideWord } from "@/markets/market-view";
import { useNetwork } from "@/network/network-store";
import { useTheme } from "@/theme/theme-provider";
import { loadDraft, saveDraft } from "@/tickets/ticket-db";
import { useWallet } from "@/wallet/wallet-store";

/**
 * The bet sheet (C3; surfaces.md Markets / detail / bet): side, a fixed ticket, what you risk and (only once odds are
 * released) a payout estimate, the Ironwood check, then one tap on testnet or "Slide to bet" on mainnet. The ticket
 * is saved before any money moves. "Pay from another wallet" builds the same ticket as a ZIP 321 QR instead.
 */
interface Draft {
  marketId: string;
  side: Side;
  size: string;
}

export default function BetSheet() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; side?: Side; external?: string }>();
  const data = useMarkets();
  const network = useNetwork();
  const wallet = useWallet();
  const now = useNow();
  const market =
    data.status === "ready" ? (data.bundle.markets.find((candidate) => candidate.id === params.id) ?? null) : null;
  const [side, setSide] = useState<Side>(params.side ?? "U");
  const [size, setSize] = useState<bigint>(TICKET_SIZES_ZAT[0] ?? 0n);
  const [placing, setPlacing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened] = useState(network);
  const external = params.external === "1";
  const coin = NETWORK_COIN[network];

  // Switching networks cancels the open sheet and any QR (plan §13.16).
  useEffect(() => {
    if (network !== opened) router.back();
  }, [network, opened]);

  // Drafts are per network: the last side and size picked for this market come back.
  useEffect(() => {
    void loadDraft<Draft>(network)
      .then((draft) => {
        if (draft && draft.marketId === params.id) {
          if (!params.side) setSide(draft.side);
          setSize(BigInt(draft.size));
        }
      })
      .catch(() => undefined);
  }, [network, params.id, params.side]);
  useEffect(() => {
    if (market)
      void saveDraft(network, { marketId: market.id, side, size: size.toString() } satisfies Draft).catch(
        () => undefined,
      );
  }, [network, market, side, size]);

  const estimate = useMemo(() => {
    if (!market?.released) return null;
    const pool = market.released.sides[side];
    return winningPayout(
      {
        ...market,
        released: {
          ...market.released,
          sides: {
            ...market.released.sides,
            [side]: { tickets: (pool?.tickets ?? 0) + 1, zat: String(BigInt(pool?.zat ?? "0") + size) },
          },
        },
      },
      side,
      size,
    );
  }, [market, side, size]);

  if (!market) {
    return (
      <EmptyState
        icon={SearchX}
        title="Market not found"
        reason="It isn't in the current signed batch."
        action={{ label: "Close", onPress: () => router.back() }}
      />
    );
  }
  if (placing) return <BetProgress hash={placing} market={market} onRetry={() => setPlacing(null)} />;

  const asset = assetFor(market);
  const open = isBettable(market, now);
  const pay = canPay(size);
  const orchard = wallet.pools?.orchard ?? 0n;
  const addresses = data.status === "ready" ? data.addresses : null;

  const bet = async () => {
    setProblem(null);
    let saved = false;
    try {
      // The steps show as soon as the ticket is saved; the send (~30 s over Nym) settles on the ticket.
      await placeBet({ network, market, side, sizeZat: size, addresses }, (hash) => {
        saved = true;
        setPlacing(hash);
      });
    } catch (error) {
      if (!saved) setProblem((error as Error).message);
    }
  };

  const showQr = async () => {
    setProblem(null);
    try {
      const hash = await prepareExternalTicket({ network, market, side, sizeZat: size, addresses });
      router.replace({ pathname: "/pay-qr", params: { hash } });
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const blocked = !open
    ? { label: "Betting is closed", onPress: () => router.back() }
    : external
      ? null
      : wallet.phase !== "ready"
        ? { label: "Open your wallet first", onPress: () => router.replace("/wallet") }
        : !pay.ok && orchard > 0n
          ? { label: "Move Orchard funds to Ironwood", onPress: () => router.replace("/migrate") }
          : !pay.ok
            ? { label: `Receive ${coin} to bet`, onPress: () => router.replace("/receive") }
            : null;

  return (
    <SheetBody title={`${SIDE_SIGN[side]} ${asset.symbol} ${sideWord(side)}`} subtitle={market.rules.question}>
      <Segmented<Side>
        label="Side"
        value={side}
        onChange={setSide}
        options={sidesOf(market).map((value) => ({ value, label: `${SIDE_SIGN[value]} ${sideWord(value)}` }))}
      />
      <View style={{ gap: theme.space.sm }}>
        <Txt variant="label" tone="muted">
          Ticket
        </Txt>
        <Chips<bigint>
          label="Ticket size"
          value={size}
          onChange={setSize}
          options={TICKET_SIZES_ZAT.map((value) => ({ value, label: coinAmount(value, coin) }))}
        />
      </View>
      <Plate raised>
        <Fact label="You risk" value={coinAmount(size, coin)} />
        <Fact
          label={`If ${sideWord(side)} wins`}
          value={estimate === null ? "Set by the final pools" : `≈ ${coinAmount(estimate, coin)}`}
        />
        {!external ? (
          <Fact
            label="Ironwood available"
            value={wallet.pools ? coinAmount(wallet.pools.ironwoodConfirmed, coin) : "Checking…"}
            tone={pay.ok ? "foreground" : "warn"}
          />
        ) : null}
        <Txt variant="meta" tone="muted">
          {estimate === null
            ? "Odds are sealed until each side has 3 tickets. Winners split the losing side, less 2 %."
            : `At the totals in batch ${market.released?.seq}, with your ticket added. The final pools decide.`}{" "}
          {external
            ? "Your wallet pays the network fee."
            : "The network fee comes from your Ironwood balance; the bet never spends Orchard."}
        </Txt>
      </Plate>
      {external ? (
        <Strip>
          Paying from Zodl? Move your funds to Ironwood first (Zodl → Migrate). Paying from Orchard reveals the amount
          on chain.
        </Strip>
      ) : null}
      {problem ? (
        <Txt variant="rowDetail" tone="destructive">
          {problem}
        </Txt>
      ) : null}
      {blocked ? (
        <Button label={blocked.label} onPress={blocked.onPress} />
      ) : external ? (
        <Button label="Make QR" onPress={() => void showQr()} />
      ) : network === "mainnet" ? (
        <SlideToConfirm label={`Slide to bet ${coinAmount(size, coin)}`} onConfirm={() => void bet()} />
      ) : (
        <Button label={`Bet ${coinAmount(size, coin)}`} onPress={() => void bet()} />
      )}
      {!external && open ? (
        <Button
          label="Pay from another wallet"
          variant="quiet"
          size="sm"
          onPress={() => router.setParams({ external: "1" })}
        />
      ) : null}
    </SheetBody>
  );
}
