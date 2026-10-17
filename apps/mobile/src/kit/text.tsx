import { Text, type TextProps } from "react-native";
import type { TextRole } from "@/theme/theme";
import { useTheme } from "@/theme/theme-provider";

/** Text roles from the tokens; tones are colour roles, never raw hex (kawase.md §4.4). */
export type Tone =
  | "foreground"
  | "muted"
  | "text3"
  | "up"
  | "down"
  | "accent"
  | "warn"
  | "destructive"
  | "link"
  | "onFill"
  | "primaryForeground"
  | "paperInk";

const TONE_KEY = {
  foreground: "foreground",
  muted: "mutedForeground",
  text3: "text3",
  up: "up",
  down: "down",
  accent: "accent",
  warn: "warn",
  destructive: "destructive",
  link: "link",
  onFill: "onFill",
  primaryForeground: "primaryForeground",
  paperInk: "paperInk",
} as const;

/** `variant` is the type role from the tokens (not the ARIA `role`, which stays available). */
export interface TxtProps extends TextProps {
  variant?: TextRole;
  tone?: Tone;
  align?: "left" | "center" | "right";
}

export function Txt({ variant = "body", tone = "foreground", align, style, ...rest }: TxtProps) {
  const theme = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={1.35}
      {...rest}
      style={[theme.text[variant], { color: theme.color[TONE_KEY[tone]] }, align ? { textAlign: align } : null, style]}
    />
  );
}
