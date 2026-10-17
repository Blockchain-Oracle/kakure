import { Check, ChevronsRight } from "lucide-react-native";
import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { SLIDE_COMMIT_FRACTION } from "@/constants";
import { haptic } from "@/feedback/fire";
import { spring, type Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { Txt } from "./text";

/**
 * Slide to confirm (kawase.md §8.1): a 56 rail and a 48 thumb; it commits past 90 % with a haptic detent and the
 * chevron turns into a check. Used for real money: "Slide to bet" on mainnet, "Slide to use real money",
 * "Slide to send".
 */
const THUMB = 48;
const RAIL_PADDING = 4;
/** The label has faded out by the time the thumb is this far along. */
const LABEL_FADE_AT = 0.6;
/**
 * Resolved once on the JS thread: the gesture callbacks are worklets on the UI runtime, which can read this plain
 * object but cannot call a JS function like spring().
 */
const RELEASE = spring("sheetRelease");

function styles(theme: Theme) {
  return StyleSheet.create({
    rail: {
      height: theme.size.buttonHeight,
      borderRadius: theme.radius.button,
      backgroundColor: theme.color.primary,
      justifyContent: "center",
      paddingHorizontal: RAIL_PADDING,
      overflow: "hidden",
    },
    label: { position: "absolute", left: 0, right: 0, alignItems: "center" },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB / 2,
      backgroundColor: theme.color.accent,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}

export function SlideToConfirm({
  label,
  onConfirm,
  busy = false,
}: {
  label: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  const s = useThemed(styles);
  const [width, setWidth] = useState(0);
  const [done, setDone] = useState(false);
  const x = useSharedValue(0);
  const max = Math.max(0, width - THUMB - RAIL_PADDING * 2);
  const crossed = useSharedValue(false);

  const commit = () => {
    setDone(true);
    haptic("confirm");
    onConfirm();
  };
  const detent = () => haptic("tick");

  const pan = Gesture.Pan()
    .enabled(!busy && !done && max > 0)
    .onUpdate((event) => {
      x.value = Math.min(max, Math.max(0, event.translationX));
      const past = x.value >= max * SLIDE_COMMIT_FRACTION;
      if (past !== crossed.value) {
        crossed.value = past;
        runOnJS(detent)();
      }
    })
    .onEnd(() => {
      if (x.value >= max * SLIDE_COMMIT_FRACTION) {
        x.value = withSpring(max, RELEASE);
        runOnJS(commit)();
      } else {
        x.value = withSpring(0, RELEASE);
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // While the work runs the thumb sits at the end, so the label comes back to say "Working…".
  const labelStyle = useAnimatedStyle(
    () => ({
      opacity: busy || max <= 0 ? 1 : interpolate(x.value, [0, max * LABEL_FADE_AT], [1, 0]),
    }),
    [busy, max],
  );

  return (
    <View
      style={s.rail}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityActions={[{ name: "activate", label }]}
      onAccessibilityAction={() => {
        if (!busy && !done) commit();
      }}
    >
      <Animated.View style={[s.label, labelStyle]} pointerEvents="none">
        <Txt variant="buttonLabel" tone="primaryForeground">
          {busy ? "Working…" : label}
        </Txt>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[s.thumb, thumbStyle]}>
          {done ? (
            <Check color={theme.color.onFill} size={theme.size.icon} strokeWidth={theme.size.iconStroke} />
          ) : (
            <ChevronsRight color={theme.color.onFill} size={theme.size.icon} strokeWidth={theme.size.iconStroke} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
