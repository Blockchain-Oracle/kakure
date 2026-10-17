import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useNetwork } from "@/network/network-store";
import { usePrefs } from "@/settings/prefs";
import { type Mode, type Theme, themeFor } from "./theme";

/**
 * The theme is the product of two choices, mode × network, giving one of the four themes (kawase.md §4.1).
 * Light is the default; dark is an adaptation, not an inversion.
 */
const ThemeContext = createContext<Theme>(themeFor("light", "testnet"));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const { appearance } = usePrefs();
  const network = useNetwork();
  const mode: Mode = appearance === "system" ? (scheme === "dark" ? "dark" : "light") : appearance;
  const theme = useMemo(() => themeFor(mode, network), [mode, network]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Reduced motion: the system setting, or the app's own "Reduce motion" switch. */
export function useMotionReduced(): boolean {
  const system = useReducedMotion();
  const { motion } = usePrefs();
  return system || motion === "reduce";
}

/** Builds a style object once per theme. */
export function useThemed<T>(build: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => build(theme), [theme]);
}
