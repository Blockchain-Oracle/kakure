import type { Network } from "@kakure/domain";
import { native } from "@kakure/tokens/native";
import type { TextStyle } from "react-native";
import { Easing } from "react-native-reanimated";

/**
 * The native theme: @kakure/tokens' React Native object (Kawase's values, kawase.md §4), resolved per
 * mode × network into one of the four themes. Components read colours and type only from here (no hex elsewhere).
 */
export type Mode = "light" | "dark";
export type Palette = (typeof native.themes)["light"];
export type TextRole = keyof typeof native.text;

const THEME_KEY: Record<Mode, Record<Network, keyof typeof native.themes>> = {
  light: { mainnet: "light", testnet: "testnetLight" },
  dark: { mainnet: "dark", testnet: "testnetDark" },
};

/**
 * Custom fonts register one family per weight (expo-font), so a token's family + weight maps to the loaded face.
 * Inter for the interface, Roboto Condensed Black for money and page titles.
 */
export const FONT_FACES = {
  "Inter-400": "Inter_400Regular",
  "Inter-500": "Inter_500Medium",
  "Inter-600": "Inter_600SemiBold",
  "Inter-700": "Inter_700Bold",
  "RobotoCondensed-900": "RobotoCondensed_900Black",
} as const;

type FaceKey = keyof typeof FONT_FACES;

function textStyle(role: TextRole): TextStyle {
  const token = native.text[role];
  const key = `${token.fontFamily}-${token.fontWeight}` as FaceKey;
  return {
    fontFamily: FONT_FACES[key] ?? FONT_FACES["Inter-400"],
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    letterSpacing: token.letterSpacing,
    ...("fontVariant" in token ? { fontVariant: [...token.fontVariant] as TextStyle["fontVariant"] } : {}),
  };
}

const TEXT = Object.fromEntries(
  (Object.keys(native.text) as TextRole[]).map((role) => [role, textStyle(role)]),
) as Record<TextRole, TextStyle>;

/** `cubic-bezier` curves from the tokens as Reanimated easings. */
function curve(points: readonly number[]) {
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = points;
  return Easing.bezier(x1, y1, x2, y2);
}

export const EASING = {
  default: curve(native.curves.default),
  sheet: curve(native.curves.sheet),
  overshoot: curve(native.curves.overshoot),
  flood: curve(native.curves.flood),
};

export interface Theme {
  mode: Mode;
  network: Network;
  color: Palette;
  text: Record<TextRole, TextStyle>;
  radius: typeof native.radius;
  space: typeof native.space;
  size: typeof native.size;
  layout: typeof native.layout;
  shadow: typeof native.shadow;
  opacity: typeof native.opacity;
}

const cache = new Map<string, Theme>();

export function themeFor(mode: Mode, network: Network): Theme {
  const key = THEME_KEY[mode][network];
  const hit = cache.get(key);
  if (hit) return hit;
  const theme: Theme = {
    mode,
    network,
    color: native.themes[key] as Palette,
    text: TEXT,
    radius: native.radius,
    space: native.space,
    size: native.size,
    layout: native.layout,
    shadow: native.shadow,
    opacity: native.opacity,
  };
  cache.set(key, theme);
  return theme;
}

export const MOTION = {
  durations: native.durations,
  springs: native.springs,
  scales: native.scales,
};

/** A Reanimated `withSpring` config from a token spring (energyThreshold is the token's settle threshold). */
export function spring(name: keyof typeof native.springs) {
  const token = native.springs[name];
  return {
    stiffness: token.stiffness,
    damping: token.damping,
    mass: token.mass,
    overshootClamping: token.overshootClamping,
  };
}

const BYTE_MAX = 255;
const HEX = 16;
/** "#RRGGBB" */
const RGB_HEX_LENGTH = 7;

/** Appends a two-digit alpha to a `#RRGGBB` token (washes, rims; kawase.md §4.3 "derived in the kit"). */
export function withAlpha(hex: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * BYTE_MAX)
    .toString(HEX)
    .padStart(2, "0");
  return `${hex.slice(0, RGB_HEX_LENGTH)}${byte}`;
}
