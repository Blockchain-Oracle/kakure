import type { Network } from "@kakure/domain";
import { router } from "expo-router";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { type GestureResponderEvent, Linking, View } from "react-native";
import { FAUCETS, NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { haptic } from "@/feedback/fire";
import { Mark } from "@/kit/mark";
import { PressScale } from "@/kit/press";
import { SheetBody } from "@/kit/screen";
import { SlideToConfirm } from "@/kit/slide-to-confirm";
import { Strip } from "@/kit/states";
import { Txt } from "@/kit/text";
import { MARKS } from "@/markets/generated/marks";
import { useSwitchNetwork } from "@/network/flood";
import { useNetwork } from "@/network/network-store";
import { useTheme } from "@/theme/theme-provider";

/**
 * The network mode sheet (C11; senryo.md §5.5): two rows. Testnet switches at once; Mainnet first reveals "Real
 * money from here." and "Slide to use real money", and only the completed slide switches. The switch floods the app
 * in the new theme from where you touched, and every wallet, ticket, draft and open QR is per network.
 */
export default function NetworkSheet() {
  const theme = useTheme();
  const current = useNetwork();
  const switchNetwork = useSwitchNetwork();
  const [armed, setArmed] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | undefined>(undefined);

  const choose = (next: Network, event?: GestureResponderEvent) => {
    haptic("tick");
    if (next === current) return;
    const from = event ? { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY } : undefined;
    if (next === "mainnet") {
      setArmed(true);
      setPoint(from);
      return;
    }
    router.back();
    switchNetwork(next, from);
  };

  const row = (network: Network, detail: string) => {
    const selected = network === current;
    return (
      <PressScale
        key={network}
        onPress={(event) => choose(network, event)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.space.md,
          padding: theme.space.lg,
          borderRadius: theme.radius.group,
          backgroundColor: selected ? theme.color.selectedRow : theme.color.card,
        }}
      >
        <Mark svg={MARKS.zec} symbol="ZEC" size={theme.size.markRow} />
        <View style={{ flex: 1, gap: theme.space.xxs }}>
          <Txt variant="rowTitle">{NETWORK_LABEL[network]}</Txt>
          <Txt variant="rowDetail" tone="muted">
            {detail}
          </Txt>
        </View>
        {selected ? <Check color={theme.color.foreground} size={theme.size.icon} /> : null}
      </PressScale>
    );
  };

  return (
    <SheetBody title="Network" subtitle="Each network has its own wallet, tickets and drafts on this phone.">
      {row("testnet", `${NETWORK_COIN.testnet} · test money from a faucet`)}
      {row("mainnet", `${NETWORK_COIN.mainnet} · real money`)}
      {armed ? (
        <View style={{ gap: theme.space.md }}>
          <Txt variant="rowStrong">Real money from here.</Txt>
          <Strip>Bets on Mainnet pay real ZEC from this phone's Mainnet wallet, from Ironwood funds only.</Strip>
          <SlideToConfirm
            label="Slide to use real money"
            onConfirm={() => {
              router.back();
              switchNetwork("mainnet", point);
            }}
          />
        </View>
      ) : null}
      {current === "testnet" ? (
        <Txt variant="meta" tone="text3">
          Need TAZ? {FAUCETS.map((faucet) => faucet.name).join(" or ")}:{" "}
          <Txt variant="meta" tone="link" onPress={() => void Linking.openURL(FAUCETS[0].href)}>
            open a faucet
          </Txt>
        </Txt>
      ) : null}
    </SheetBody>
  );
}
