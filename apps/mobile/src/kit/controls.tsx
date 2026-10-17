import { useEffect, useState } from "react";
import { type LayoutChangeEvent, ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptic } from "@/feedback/fire";
import type { PillTone } from "@/markets/market-view";
import { MOTION, spring, type Theme } from "@/theme/theme";
import { useMotionReduced, useTheme, useThemed } from "@/theme/theme-provider";
import { PressScale } from "./press";
import { Txt } from "./text";

function styles(theme: Theme) {
  return StyleSheet.create({
    chipRow: { gap: theme.space.sm, paddingVertical: theme.space.xxs },
    chip: {
      height: theme.size.chipHeight,
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.chip,
      backgroundColor: theme.color.secondary,
      justifyContent: "center",
    },
    chipSelected: { backgroundColor: theme.color.accent },
    segment: {
      flexDirection: "row",
      backgroundColor: theme.color.secondary,
      borderRadius: theme.radius.pill,
      padding: theme.space.xxs,
    },
    segmentItem: {
      flex: 1,
      height: theme.size.chipRowHeight + theme.space.sm,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1,
    },
    segmentPill: {
      position: "absolute",
      top: theme.space.xxs,
      bottom: theme.space.xxs,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.card,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.xs,
      alignSelf: "flex-start",
      paddingHorizontal: theme.space.sm,
      height: theme.size.chipHeight - theme.space.sm,
      borderRadius: theme.radius.pill,
    },
    dot: { width: theme.size.dot, height: theme.size.dot, borderRadius: theme.size.dot / 2 },
  });
}

export interface ChipOption<T> {
  value: T;
  label: string;
}

/** Fixed choices (ticket sizes, filters): the selected chip is the one magenta moment (kawase.md §4.3). */
export function Chips<T extends string | bigint>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const s = useThemed(styles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.chipRow}
      accessibilityLabel={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressScale
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[s.chip, selected && s.chipSelected]}
          >
            <Txt variant="chipCategory" tone={selected ? "onFill" : "foreground"}>
              {option.label}
            </Txt>
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

/** Segmented control: one pill springs to the selected item ("one object travelling, not a swap"). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const s = useThemed(styles);
  const reduced = useMotionReduced();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const itemWidth = options.length > 0 ? width / options.length : 0;
  const offset = useSharedValue(0);
  useEffect(() => {
    const target = index * itemWidth;
    offset.value = reduced ? target : withSpring(target, spring("compactSelector"));
  }, [index, itemWidth, reduced, offset]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  return (
    <View
      style={s.segment}
      accessibilityRole="tablist"
      accessibilityLabel={label}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width - SEGMENT_PADDING * 2)}
    >
      {itemWidth > 0 ? (
        <Animated.View style={[s.segmentPill, { width: itemWidth, left: SEGMENT_PADDING }, pill]} />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressScale
            key={option.value}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={s.segmentItem}
          >
            <Txt variant={selected ? "rowStrong" : "row"} tone={selected ? "foreground" : "muted"}>
              {option.label}
            </Txt>
          </PressScale>
        );
      })}
    </View>
  );
}

const PILL_COLORS: Record<PillTone, { bg: keyof Theme["color"]; fg: keyof Theme["color"] }> = {
  neutral: { bg: "secondary", fg: "foreground" },
  quiet: { bg: "secondary", fg: "mutedForeground" },
  warn: { bg: "warnSurface", fg: "warn" },
  up: { bg: "upSurface", fg: "up" },
  down: { bg: "downSurface", fg: "down" },
  accent: { bg: "selectedRow", fg: "foreground" },
};

const PULSE_LOW = 0.35;
/** The segmented plate's inner padding (space.xxs), on each side. */
const SEGMENT_PADDING = 2;

/** A state pill; a pulsing dot marks a live state (Open, Closing, Resolving). Never colour alone: it has words. */
export function Pill({ label, tone = "neutral", pulse = false }: { label: string; tone?: PillTone; pulse?: boolean }) {
  const theme = useTheme();
  const s = useThemed(styles);
  const reduced = useMotionReduced();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!pulse || reduced) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(PULSE_LOW, { duration: MOTION.durations.skeletonPeriod / 2 }),
        withTiming(1, { duration: MOTION.durations.skeletonPeriod / 2 }),
      ),
      -1,
    );
  }, [pulse, reduced, opacity]);
  const dot = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const colors = PILL_COLORS[tone];
  return (
    <View style={[s.pill, { backgroundColor: theme.color[colors.bg] }]}>
      {pulse ? <Animated.View style={[s.dot, { backgroundColor: theme.color[colors.fg] }, dot]} /> : null}
      <Txt variant="chipLabel" style={{ color: theme.color[colors.fg] }}>
        {label}
      </Txt>
    </View>
  );
}

/** Fires a tick haptic when a value changes (segmented, chips), for controls built outside this kit. */
export const tick = () => haptic("tick");
