import { CloudOff, type LucideIcon } from "lucide-react-native";
import { type ReactNode, useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { formatAge } from "@/lib/time";
import { MOTION, type Theme } from "@/theme/theme";
import { useMotionReduced, useTheme, useThemed } from "@/theme/theme-provider";
import { Button } from "./button";
import { Txt } from "./text";

/**
 * Designed states (kawase.md §3.3, R9): skeletons shaped like the real layout (pulsing 1200 ms, still under
 * reduced motion), empty states that say why and name the next action, errors that name the fix, stale values
 * that stay at full ink with their age.
 */
function styles(theme: Theme) {
  return StyleSheet.create({
    skeleton: { backgroundColor: theme.color.skeleton, borderRadius: theme.radius.sm },
    empty: {
      alignItems: "center",
      gap: theme.space.md,
      paddingVertical: theme.space.xxl,
      paddingHorizontal: theme.space.xl,
    },
    emptyIcon: {
      width: theme.size.avatarLg,
      height: theme.size.avatarLg,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.color.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    actions: { alignSelf: "stretch", gap: theme.space.sm, marginTop: theme.space.sm },
    stale: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
    staleDot: {
      width: theme.size.dot,
      height: theme.size.dot,
      borderRadius: theme.size.dot / 2,
      backgroundColor: theme.color.warn,
    },
    strip: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.warnSurface,
    },
  });
}

export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const theme = useTheme();
  const s = useThemed(styles);
  const reduced = useMotionReduced();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    opacity.value = withRepeat(
      withTiming(theme.opacity.skeletonFrom, { duration: MOTION.durations.skeletonPeriod / 2 }),
      -1,
      true,
    );
  }, [reduced, opacity, theme]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[s.skeleton, style, animated]} />;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  reason: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  tone?: "neutral" | "warn";
  children?: ReactNode;
}

export function EmptyState({ icon: Icon, title, reason, action, secondary, children }: EmptyStateProps) {
  const theme = useTheme();
  const s = useThemed(styles);
  return (
    <View style={s.empty}>
      {Icon ? (
        <View style={s.emptyIcon}>
          <Icon color={theme.color.foreground} size={theme.size.icon} strokeWidth={theme.size.iconStroke} />
        </View>
      ) : null}
      <Txt variant="title" align="center">
        {title}
      </Txt>
      <Txt variant="body" tone="muted" align="center">
        {reason}
      </Txt>
      {children}
      {action || secondary ? (
        <View style={s.actions}>
          {action ? <Button label={action.label} onPress={action.onPress} /> : null}
          {secondary ? (
            <Button label={secondary.label} onPress={secondary.onPress} variant="secondary" size="md" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** An error says what still works, plus one action; technical text stays out of the headline. */
export function ErrorState({ title, reason, onRetry }: { title: string; reason: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={CloudOff}
      title={title}
      reason={reason}
      {...(onRetry ? { action: { label: "Try again", onPress: onRetry } } : {})}
    />
  );
}

/** "Stale · 3 min": cached values stay at full ink, marked with their age (R7). */
export function StaleTick({ since, now, label = "Stale" }: { since: number; now: number; label?: string }) {
  const s = useThemed(styles);
  return (
    <View style={s.stale} accessibilityLabel={`${label}, ${formatAge(now - since)} old`}>
      <View style={s.staleDot} />
      <Txt variant="micro" tone="warn">
        {label} · {formatAge(now - since)}
      </Txt>
    </View>
  );
}

export function Strip({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  const theme = useTheme();
  const s = useThemed(styles);
  return (
    <View style={s.strip}>
      {Icon ? <Icon color={theme.color.warn} size={theme.size.iconSm} /> : null}
      <Txt variant="rowDetail" tone="warn" style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}
