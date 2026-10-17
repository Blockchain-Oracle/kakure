import { router } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { NETWORK_LABEL } from "@/constants";
import { Mark } from "@/kit/mark";
import { PressScale } from "@/kit/press";
import { Txt } from "@/kit/text";
import { MARKS } from "@/markets/generated/marks";
import { useNetwork } from "@/network/network-store";
import { spring, type Theme } from "@/theme/theme";
import { useMotionReduced, useTheme, useThemed } from "@/theme/theme-provider";

/**
 * The mode capsule (kawase.md §5): a 34 pt borderless capsule with the Zcash mark, the word, and a two-position
 * switch whose knob springs. Testnet's track is hollow, mainnet's filled (difference by shape and word, never
 * colour alone). It carries the one glow (R10). A tap opens the network sheet.
 */
const KNOB_MARGIN = 2;

function styles(theme: Theme) {
  return StyleSheet.create({
    capsule: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      height: theme.size.modeCapsuleHeight,
      paddingLeft: theme.space.xs,
      paddingRight: theme.space.md,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.networkSurface,
      boxShadow: `0px 0px 14px 1px ${theme.color.glowSoft}`,
    },
    track: {
      width: theme.size.modeTrackWidth,
      height: theme.size.modeTrackHeight,
      borderRadius: theme.size.modeTrackHeight / 2,
      borderWidth: theme.size.modeTrackBorder,
      borderColor: theme.color.network,
      justifyContent: "center",
    },
    knob: {
      width: theme.size.modeKnob,
      height: theme.size.modeKnob,
      borderRadius: theme.size.modeKnob / 2,
      marginHorizontal: KNOB_MARGIN,
    },
  });
}

export function ModeCapsule() {
  const theme = useTheme();
  const s = useThemed(styles);
  const network = useNetwork();
  const reduced = useMotionReduced();
  const mainnet = network === "mainnet";
  const travel = theme.size.modeTrackWidth - theme.size.modeKnob - theme.size.modeTrackBorder * 2 - KNOB_MARGIN * 2;
  const x = useSharedValue(mainnet ? travel : 0);
  useEffect(() => {
    const target = mainnet ? travel : 0;
    x.value = reduced ? target : withSpring(target, spring("modeThumb"));
  }, [mainnet, travel, reduced, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <PressScale
      onPress={() => router.push("/network")}
      accessibilityLabel={`${NETWORK_LABEL[network]}. Change network`}
      style={s.capsule}
    >
      <Mark svg={MARKS.zec} symbol="ZEC" size={theme.size.markCell} />
      <Txt variant="modeLabel" style={{ color: theme.color.networkLabel }}>
        {NETWORK_LABEL[network]}
      </Txt>
      <View style={[s.track, mainnet && { backgroundColor: theme.color.network }]}>
        <Animated.View
          style={[s.knob, { backgroundColor: mainnet ? theme.color.networkForeground : theme.color.network }, knob]}
        />
      </View>
    </PressScale>
  );
}
