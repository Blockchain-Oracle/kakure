import { MARKET_ID_PATTERN, NETWORKS, type Network, parsePaymentUri, zatToZec } from "@kakure/domain";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { ClipboardPaste, Flashlight, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NETWORK_LABEL, SITE_HOST } from "@/constants";
import { haptic } from "@/feedback/fire";
import { Button } from "@/kit/button";
import { PressScale } from "@/kit/press";
import { Txt } from "@/kit/text";
import { networkStore } from "@/network/network-store";
import { themeFor } from "@/theme/theme";
import { useMotionReduced } from "@/theme/theme-provider";

/**
 * The scanner (kawase.md §8.4): a market-link QR (`getkakure.xyz/m#<network>/<id>`, market id only) opens its bet
 * sheet; a ZIP 321 code or a bare address opens Send. A link for the other network never opens silently: it goes
 * through the network sheet first. The camera is always dark, with a magenta viewfinder; without camera access,
 * pasting still works.
 */
const FINDER = 240;
const BREATHE = 1.04;
const BREATHE_MS = 1400;

export type ScanResult =
  | { kind: "market"; network: Network; id: string }
  | { kind: "pay"; address: string; amount?: string; memo?: string }
  | { kind: "unknown"; reason: string };

export function readCode(raw: string): ScanResult {
  const text = raw.trim();
  try {
    const url = new URL(text);
    if (url.host === SITE_HOST || url.host === `www.${SITE_HOST}`) {
      const [network, id] = decodeURIComponent(url.hash.replace(/^#/, "")).split("/");
      if (
        url.pathname.startsWith("/m") &&
        network &&
        id &&
        (NETWORKS as readonly string[]).includes(network) &&
        MARKET_ID_PATTERN.test(id)
      ) {
        return { kind: "market", network: network as Network, id };
      }
      return { kind: "unknown", reason: "That Kakure link isn't a market link." };
    }
  } catch {
    // Not a URL; try a payment code or an address.
  }
  if (text.toLowerCase().startsWith("zcash:")) {
    try {
      const request = parsePaymentUri(text);
      return {
        kind: "pay",
        address: request.address,
        amount: zatToZec(request.amountZat),
        ...(request.memo ? { memo: request.memo } : {}),
      };
    } catch (error) {
      return { kind: "unknown", reason: (error as Error).message };
    }
  }
  if (/^(u|utest|zs|ztestsapling|t1|t3|tm|tex|textest)1?[0-9a-z]{25,}$/i.test(text))
    return { kind: "pay", address: text };
  return { kind: "unknown", reason: "That code isn't a Kakure market link or a Zcash payment." };
}

export default function Scan() {
  const { purpose } = useLocalSearchParams<{ purpose?: string }>();
  const insets = useSafeAreaInsets();
  const reduced = useMotionReduced();
  const dark = themeFor("dark", networkStore.get());
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handled = useRef(false);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!reduced)
      scale.value = withRepeat(
        withTiming(BREATHE, { duration: BREATHE_MS, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
  }, [reduced, scale]);
  const breathe = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const open = (raw: string) => {
    if (handled.current) return;
    const result = readCode(raw);
    if (result.kind === "unknown") {
      setProblem(result.reason);
      haptic("warn");
      return;
    }
    handled.current = true;
    haptic("confirm");
    if (result.kind === "pay") {
      router.replace({
        pathname: "/send",
        params: {
          to: result.address,
          ...(result.amount ? { amount: result.amount } : {}),
          ...(result.memo ? { memo: result.memo } : {}),
        },
      });
      return;
    }
    if (purpose === "send") {
      setProblem("That's a market link, not a payment address.");
      handled.current = false;
      return;
    }
    if (result.network !== networkStore.get()) {
      setProblem(`This link is for ${NETWORK_LABEL[result.network]}. Switch network, then scan it again.`);
      handled.current = false;
      router.push("/network");
      return;
    }
    router.replace({ pathname: "/market/[id]", params: { id: result.id } });
    setTimeout(() => router.push({ pathname: "/bet", params: { id: result.id } }), 0);
  };

  const paste = async () => open(await Clipboard.getStringAsync());

  return (
    <View style={[styles.page, { backgroundColor: dark.color.background }]}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => open(data)}
        />
      ) : null}
      <View
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + dark.space.md,
            paddingBottom: insets.bottom + dark.space.xl,
            paddingHorizontal: dark.space.inset,
          },
        ]}
      >
        <View style={styles.top}>
          <PressScale onPress={() => router.back()} accessibilityLabel="Close the scanner" style={styles.icon}>
            <X color={dark.color.foreground} size={dark.size.icon} />
          </PressScale>
          {permission?.granted ? (
            <PressScale
              onPress={() => setTorch(!torch)}
              accessibilityLabel={torch ? "Torch off" : "Torch on"}
              style={styles.icon}
            >
              <Flashlight color={torch ? dark.color.accent : dark.color.foreground} size={dark.size.icon} />
            </PressScale>
          ) : null}
        </View>
        <Animated.View
          style={[styles.finder, { borderColor: dark.color.accent, borderRadius: dark.radius.lg }, breathe]}
        />
        <View style={{ gap: dark.space.md }}>
          <Txt variant="rowStrong" align="center" style={{ color: dark.color.foreground }}>
            {purpose === "send" ? "Scan a Zcash address or payment code" : "Scan a market link from getkakure.xyz"}
          </Txt>
          {problem ? (
            <Txt variant="rowDetail" align="center" style={{ color: dark.color.warn }}>
              {problem}
            </Txt>
          ) : null}
          {!permission?.granted ? (
            <>
              <Txt variant="rowDetail" align="center" style={{ color: dark.color.mutedForeground }}>
                {permission?.canAskAgain === false
                  ? "Camera access is off for Kakure. Allow it in Settings, or paste instead."
                  : "Kakure needs the camera to scan codes."}
              </Txt>
              {permission?.canAskAgain !== false ? (
                <Button label="Allow camera" onPress={() => void requestPermission()} />
              ) : null}
            </>
          ) : null}
          <Button
            label="Paste instead"
            icon={ClipboardPaste}
            variant="secondary"
            size="md"
            onPress={() => void paste()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  overlay: { flex: 1, justifyContent: "space-between" },
  top: { flexDirection: "row", justifyContent: "space-between" },
  icon: { padding: 8 },
  finder: { alignSelf: "center", width: FINDER, height: FINDER, borderWidth: 3 },
});
