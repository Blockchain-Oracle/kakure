import { zatToZec } from "@kakure/domain";
import { router } from "expo-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Droplets,
  History,
  Repeat,
  ShieldCheck,
  WalletMinimal,
} from "lucide-react-native";
import { Linking, View } from "react-native";
import { FAUCETS, NETWORK_COIN, NETWORK_LABEL, WALLET_SYNC_EVERY_MS } from "@/constants";
import { Button } from "@/kit/button";
import { Pill } from "@/kit/controls";
import { Screen } from "@/kit/screen";
import { EmptyState, ErrorState, Skeleton, StaleTick } from "@/kit/states";
import { Plate, Row, Section } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { useNow } from "@/lib/time";
import { useNetwork } from "@/network/network-store";
import { usePrefs } from "@/settings/prefs";
import { useTheme } from "@/theme/theme-provider";
import { createWallet, openWallet, syncWallet, useWallet } from "@/wallet/wallet-store";

/**
 * Wallet (C10, surfaces.md): the Kawase money card with Ironwood as the hero figure and an Orchard legacy line with
 * a Migrate prompt; Receive, Send, Activity; sync and private-route state. Balances are per pool, so a bet never
 * crosses pools.
 */
export default function WalletTab() {
  const theme = useTheme();
  const wallet = useWallet();
  const network = useNetwork();
  const now = useNow();
  const { hideAmounts } = usePrefs();
  const coin = NETWORK_COIN[network];
  const amount = (zat: bigint) => (hideAmounts ? "Hidden" : `${zatToZec(zat)} ${coin}`);

  if (wallet.phase === "unknown" || wallet.phase === "opening") {
    return (
      <Screen title="Wallet">
        <Skeleton style={{ height: 180, borderRadius: theme.radius.group }} />
        <Skeleton style={{ height: 64, borderRadius: theme.radius.group }} />
      </Screen>
    );
  }
  if (wallet.phase === "absent") {
    return (
      <Screen title="Wallet">
        <EmptyState
          icon={WalletMinimal}
          title={`No ${NETWORK_LABEL[network]} wallet on this phone`}
          reason="Each network has its own wallet. Create one here, or restore from your recovery words."
          action={{
            label: "Create wallet",
            onPress: () => void createWallet(network).then(() => router.push("/backup")),
          }}
          secondary={{ label: "Restore", onPress: () => router.push("/restore") }}
        />
      </Screen>
    );
  }
  if (wallet.phase === "error") {
    return (
      <Screen title="Wallet">
        <ErrorState
          title="The wallet didn't open"
          reason={`${wallet.error?.message ?? "Unknown error"}. Your funds are safe in your recovery words; try again.`}
          onRetry={() => void openWallet(network)}
        />
      </Screen>
    );
  }

  const pools = wallet.pools;
  const syncing = wallet.sync.phase === "running";
  const behind =
    wallet.sync.serverHeight !== null &&
    wallet.sync.walletHeight !== null &&
    wallet.sync.serverHeight > wallet.sync.walletHeight;

  return (
    <Screen title="Wallet" refreshing={syncing} onRefresh={() => void syncWallet()}>
      <Plate>
        <Txt variant="label" tone="muted">
          Ironwood · ready to bet
        </Txt>
        {pools ? (
          <Txt variant="displayBalance" accessibilityLabel={`Ironwood balance ${amount(pools.ironwood)}`}>
            {hideAmounts ? "Hidden" : zatToZec(pools.ironwood)}
            {hideAmounts ? "" : <Txt variant="numMd" tone="muted">{` ${coin}`}</Txt>}
          </Txt>
        ) : (
          <Skeleton style={{ height: 56, width: "60%" }} />
        )}
        {pools && pools.ironwood !== pools.ironwoodConfirmed ? (
          <Txt variant="rowDetail" tone="muted">
            {amount(pools.ironwoodConfirmed)} spendable now · the rest confirms in a few blocks
          </Txt>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm }}>
          <Pill
            label={
              syncing
                ? `Syncing ${Math.round(wallet.sync.percent)}%`
                : behind
                  ? "Behind the tip"
                  : `Synced · block ${wallet.sync.walletHeight ?? "—"}`
            }
            tone={syncing ? "neutral" : behind ? "warn" : "up"}
            pulse={syncing}
          />
          <Pill
            label={
              wallet.mixnet === "ready"
                ? "Private route ready"
                : wallet.mixnet === "warming"
                  ? "Joining Nym…"
                  : "Private route off"
            }
            tone={wallet.mixnet === "ready" ? "up" : "quiet"}
            pulse={wallet.mixnet === "warming"}
          />
        </View>
        {wallet.balanceAt && now - wallet.balanceAt > WALLET_SYNC_EVERY_MS * 2 ? (
          <StaleTick since={wallet.balanceAt} now={now} label="Balance from" />
        ) : null}
      </Plate>

      {pools && pools.orchard > 0n ? (
        <Row
          icon={Repeat}
          title={`Orchard (legacy) · ${amount(pools.orchard)}`}
          detail="Bets spend Ironwood only. Move these funds to bet with them."
          onPress={() => router.push("/migrate")}
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: theme.space.md }}>
        <View style={{ flex: 1 }}>
          <Button label="Receive" icon={ArrowDownLeft} onPress={() => router.push("/receive")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Send" icon={ArrowUpRight} variant="secondary" onPress={() => router.push("/send")} />
        </View>
      </View>

      <Section>
        <Row
          icon={History}
          title="Activity"
          detail={`${wallet.activity.length} on this wallet`}
          onPress={() => router.push("/activity")}
        />
        <Row
          icon={ShieldCheck}
          title="Recovery words"
          detail="Show and check your backup"
          onPress={() => router.push("/backup")}
        />
      </Section>

      {network === "testnet" ? (
        <Section label="Test money">
          {FAUCETS.map((faucet) => (
            <Row
              key={faucet.name}
              icon={Droplets}
              title={`Get TAZ from ${faucet.name}`}
              detail="Paste your Receive address there"
              onPress={() => void Linking.openURL(faucet.href)}
            />
          ))}
        </Section>
      ) : null}

      <Txt variant="meta" tone="text3">
        Sends travel over the Nym mixnet, so the server that relays them doesn't learn your IP. Syncing reads the chain
        from {NETWORK_LABEL[network]}'s public light-wallet server.
      </Txt>
    </Screen>
  );
}
