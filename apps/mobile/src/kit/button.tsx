import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { PressScale } from "./press";
import { Txt } from "./text";

/**
 * Buttons (kawase.md §4.5): 56 high (48 secondary, 44 compact), black primary plates, quiet secondary plates.
 * A blocked CTA wears its fix instead of greying out, so there is no disabled look here except `busy`.
 */
export type ButtonVariant = "primary" | "secondary" | "accent" | "destructive" | "quiet";
export type ButtonSize = "lg" | "md" | "sm";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** A wait: the label stays (a verb such as "Sending…"), the plate never looks disabled. */
  busy?: boolean;
  accessibilityHint?: string;
  trailing?: ReactNode;
  stretch?: boolean;
}

function styles(theme: Theme) {
  return StyleSheet.create({
    base: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.space.sm },
    lg: { height: theme.size.buttonHeight, borderRadius: theme.radius.button, paddingHorizontal: theme.space.xl },
    md: {
      height: theme.size.buttonSecondaryHeight,
      borderRadius: theme.radius.button,
      paddingHorizontal: theme.space.lgPlus,
    },
    sm: {
      height: theme.size.buttonCompactHeight,
      borderRadius: theme.radius.buttonCompact,
      paddingHorizontal: theme.space.lg,
    },
    primary: { backgroundColor: theme.color.primary, boxShadow: theme.shadow.button.boxShadow },
    secondary: { backgroundColor: theme.color.secondary },
    accent: { backgroundColor: theme.color.accent },
    destructive: { backgroundColor: theme.color.destructive },
    quiet: { backgroundColor: "transparent" },
    stretch: { alignSelf: "stretch" },
  });
}

const LABEL_TONE = {
  primary: "primaryForeground",
  secondary: "foreground",
  accent: "onFill",
  destructive: "primaryForeground",
  quiet: "link",
} as const;

const LABEL_COLOR = {
  primary: "primaryForeground",
  secondary: "foreground",
  accent: "onFill",
  destructive: "destructiveForeground",
  quiet: "link",
} as const;

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon: Icon,
  busy = false,
  accessibilityHint,
  trailing,
  stretch = true,
}: ButtonProps) {
  const theme = useTheme();
  const s = useThemed(styles);
  const tone = LABEL_TONE[variant];
  const color = theme.color[LABEL_COLOR[variant]];
  return (
    <PressScale
      onPress={busy ? undefined : onPress}
      feedback={variant === "quiet" ? "tick" : "press"}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy }}
      style={[s.base, s[size], s[variant], stretch && s.stretch]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : Icon ? (
        <Icon color={color} size={theme.size.railIcon} strokeWidth={theme.size.iconStroke} />
      ) : null}
      <Txt variant={size === "sm" ? "buttonCompact" : "buttonLabel"} tone={tone}>
        {label}
      </Txt>
      {trailing ? <View>{trailing}</View> : null}
    </PressScale>
  );
}
