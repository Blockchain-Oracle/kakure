import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import { ChartNoAxesColumn, Settings, Ticket, Wallet } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { haptic } from "@/feedback/fire";
import { MOTION, spring, type Theme } from "@/theme/theme";
import { useMotionReduced, useTheme, useThemed } from "@/theme/theme-provider";

/**
 * The glass dock (kawase.md §5): an icon-only capsule floating above the home indicator, Markets · Portfolio ·
 * Wallet · Settings. A bubble springs to the active slot (dockBubble 420/30, with overshoot). Liquid Glass on
 * iOS 26, a blur elsewhere, an opaque plate under Reduce Transparency. It slides away while the keyboard is up
 * (sheets cover it natively). A long press on any slot opens the network sheet (C11).
 */
const ICONS = { markets: ChartNoAxesColumn, portfolio: Ticket, wallet: Wallet, settings: Settings } as const;
const LABELS = { markets: "Markets", portfolio: "Portfolio", wallet: "Wallet", settings: "Settings" } as const;
const HIDE_DISTANCE = 120;
const ACTIVE_STROKE = 2.4;
const BUBBLE_INSET = 8;

function styles(theme: Theme) {
  return StyleSheet.create({
    wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
    capsule: {
      flexDirection: "row",
      height: theme.size.dockHeight,
      borderRadius: theme.radius.dock,
      paddingHorizontal: BUBBLE_INSET,
      alignItems: "center",
      overflow: "hidden",
      boxShadow: theme.shadow.dock.boxShadow,
    },
    opaque: { backgroundColor: theme.color.glassOpaque },
    translucent: { backgroundColor: theme.color.glass },
    slot: {
      width: theme.size.dockSlot + BUBBLE_INSET * 2,
      height: theme.size.dockSlot,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1,
    },
    bubble: {
      position: "absolute",
      left: BUBBLE_INSET,
      top: (theme.size.dockHeight - theme.size.dockSlot) / 2,
      width: theme.size.dockSlot + BUBBLE_INSET * 2,
      height: theme.size.dockSlot,
      borderRadius: theme.size.dockSlot / 2,
      backgroundColor: theme.color.raised2,
    },
  });
}

export function Dock({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const theme = useTheme();
  const s = useThemed(styles);
  const reduced = useMotionReduced();
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const slotWidth = theme.size.dockSlot + BUBBLE_INSET * 2;
  const bubbleX = useSharedValue(state.index * slotWidth + BUBBLE_INSET);
  const hidden = useSharedValue(0);

  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduceTransparency);
    const show = Keyboard.addListener("keyboardWillShow", () => {
      hidden.value = withTiming(1, { duration: MOTION.durations.sheetExit });
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => {
      hidden.value = withTiming(0, { duration: MOTION.durations.sheetEnter });
    });
    return () => {
      sub.remove();
      show.remove();
      hide.remove();
    };
  }, [hidden]);

  useEffect(() => {
    const target = state.index * slotWidth + BUBBLE_INSET;
    bubbleX.value = reduced ? target : withSpring(target, spring("dockBubble"));
  }, [state.index, slotWidth, reduced, bubbleX]);

  const bubble = useAnimatedStyle(() => ({ transform: [{ translateX: bubbleX.value - BUBBLE_INSET }] }));
  const wrap = useAnimatedStyle(() => ({
    opacity: 1 - hidden.value,
    transform: [{ translateY: hidden.value * HIDE_DISTANCE }],
  }));

  // Liquid Glass on iOS 26; a blur on older iOS; Android's BlurView needs a blur target, so it gets the
  // translucent glass plate; Reduce Transparency gets the opaque plate everywhere.
  const glass = !reduceTransparency && isLiquidGlassAvailable();
  const blur = !glass && !reduceTransparency && Platform.OS === "ios";
  const Plate = glass ? GlassView : blur ? BlurView : View;
  const plateProps = glass
    ? { glassEffectStyle: "regular" as const }
    : blur
      ? { intensity: 60, tint: theme.mode === "dark" ? ("dark" as const) : ("light" as const) }
      : {};

  return (
    <Animated.View
      style={[
        s.wrap,
        { bottom: Math.max(insets.bottom + theme.layout.dockBottomOffset, theme.layout.dockMinBottom) },
        wrap,
      ]}
      pointerEvents="box-none"
    >
      <Plate
        {...plateProps}
        style={[s.capsule, !glass && !blur ? (reduceTransparency ? s.opaque : s.translucent) : null]}
      >
        <Animated.View style={[s.bubble, bubble]} />
        {state.routes.map((route, index) => {
          const focused = index === state.index;
          const name = route.name as keyof typeof ICONS;
          const Icon = ICONS[name] ?? ChartNoAxesColumn;
          const label = LABELS[name] ?? descriptors[route.key]?.options.title ?? route.name;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              accessibilityHint="Hold to switch network"
              delayLongPress={350}
              onPress={() => {
                const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  haptic("tick");
                  navigateToTab(route.key);
                }
              }}
              onLongPress={() => {
                haptic("snap");
                router.push("/network");
              }}
              style={s.slot}
            >
              <Icon
                color={focused ? theme.color.foreground : theme.color.mutedForeground}
                size={theme.size.dockIcon}
                strokeWidth={focused ? ACTIVE_STROKE : theme.size.iconStroke}
              />
            </Pressable>
          );
        })}
      </Plate>
    </Animated.View>
  );
}

/** Pages pad their bottom by this so content clears the floating dock. */
export function useDockClearance(): number {
  const theme = useTheme();
  return theme.size.dockHeight + theme.layout.dockMinBottom * 2 + theme.space.xxl;
}
