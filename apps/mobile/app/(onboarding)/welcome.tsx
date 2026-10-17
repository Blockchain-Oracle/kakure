import type { Network } from "@kakure/domain";
import { router } from "expo-router";
import { EyeOff, Landmark, Smartphone } from "lucide-react-native";
import { useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NETWORK_LABEL } from "@/constants";
import { Button } from "@/kit/button";
import { Segmented } from "@/kit/controls";
import { Txt } from "@/kit/text";
import { networkStore, useNetwork } from "@/network/network-store";
import { onboardedStore } from "@/onboarding/onboarded";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { createWallet, openWallet } from "@/wallet/wallet-store";

/**
 * First run (surfaces.md Mobile → First run): three short slides on the promise, then the network (testnet
 * suggested for trying it) and Create wallet or Restore. A wallet already on this phone is opened, never replaced.
 */
const SLIDES = [
  {
    icon: Landmark,
    title: "Call the close.",
    body: "Bet Up or Down on crypto, US stocks and Zcash itself, with shielded ZEC.",
  },
  {
    icon: EyeOff,
    title: "Odds public. Bettors private.",
    body: "Every pool is signed and published. Who placed each bet never is.",
  },
  {
    icon: Smartphone,
    title: "Your wallet, on this phone.",
    body: "No account, no email. Keys and tickets stay on this device, encrypted.",
  },
] as const;

/** The current slide's dot stretches to this many dots wide. */
const ACTIVE_DOT = 3;

function styles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.color.background },
    slide: { justifyContent: "center", paddingHorizontal: theme.space.xl, gap: theme.space.lg },
    art: {
      width: theme.size.avatarXl,
      height: theme.size.avatarXl,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.color.card,
      alignItems: "center",
      justifyContent: "center",
    },
    dots: { flexDirection: "row", gap: theme.space.sm, justifyContent: "center" },
    dot: {
      width: theme.size.dot,
      height: theme.size.dot,
      borderRadius: theme.size.dot / 2,
      backgroundColor: theme.color.border,
    },
    dotOn: { backgroundColor: theme.color.foreground, width: theme.size.dot * ACTIVE_DOT },
    foot: { paddingHorizontal: theme.space.inset, gap: theme.space.md },
  });
}

export default function Welcome() {
  const theme = useTheme();
  const s = useThemed(styles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const network = useNetwork();
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const existing = await openWallet(network);
      if (existing === "ready") {
        onboardedStore.set(true);
        router.replace("/markets");
        return;
      }
      await createWallet(network);
      router.push("/backup?firstRun=1");
    } catch (error) {
      setProblem(`The wallet couldn't be created: ${(error as Error).message}. Check the connection and try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.page, { paddingTop: insets.top, paddingBottom: insets.bottom + theme.space.lg }]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[s.slide, { width }]}>
            <View style={s.art}>
              <slide.icon
                color={theme.color.foreground}
                size={theme.size.avatarMd}
                strokeWidth={theme.size.iconStroke}
              />
            </View>
            <Txt variant="pageTitle">{slide.title}</Txt>
            <Txt variant="body" tone="muted">
              {slide.body}
            </Txt>
          </View>
        ))}
      </ScrollView>
      <View style={s.foot}>
        <View style={s.dots} accessibilityLabel={`Slide ${page + 1} of ${SLIDES.length}`}>
          {SLIDES.map((slide, index) => (
            <View key={slide.title} style={[s.dot, index === page && s.dotOn]} />
          ))}
        </View>
        <Segmented<Network>
          label="Network"
          value={network}
          onChange={(next) => networkStore.set(next)}
          options={[
            { value: "testnet", label: `${NETWORK_LABEL.testnet} · try it` },
            { value: "mainnet", label: NETWORK_LABEL.mainnet },
          ]}
        />
        <Txt variant="meta" tone="muted" align="center">
          {network === "testnet"
            ? "Testnet uses TAZ, test money with no value, from a faucet."
            : "Mainnet uses real ZEC."}
        </Txt>
        {problem ? (
          <Txt variant="rowDetail" tone="destructive" align="center">
            {problem}
          </Txt>
        ) : null}
        <Button label={busy ? "Creating your wallet…" : "Create wallet"} onPress={() => void create()} busy={busy} />
        <Button
          label="I have a recovery phrase"
          variant="secondary"
          size="md"
          onPress={() => router.push("/restore")}
        />
      </View>
    </View>
  );
}
