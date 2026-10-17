import type { Network } from "@kakure/domain";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { Dimensions, StyleSheet } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { fire } from "@/feedback/fire";
import { EASING, MOTION, themeFor } from "@/theme/theme";
import { useMotionReduced, useTheme } from "@/theme/theme-provider";
import { networkStore } from "./network-store";

/**
 * The network switch's flood (C11; Senryo's flood + Owarine's whole-environment re-tint, senryo.md §5): a circle of
 * the new theme's ground spreads from the touch point over 520 ms with a glowing rim (the one glow, R10), the app
 * re-tints underneath, then the circle settles away. Reduced motion: a 100 ms crossfade.
 */
type SwitchNetwork = (next: Network, from?: { x: number; y: number }) => void;

const FloodContext = createContext<SwitchNetwork>((next) => networkStore.set(next));
export const useSwitchNetwork = () => useContext(FloodContext);

const RIM = 3;
const GLOW_BLUR = 24;

export function FloodProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const reduced = useMotionReduced();
  const [flood, setFlood] = useState<{ color: string; glow: string; x: number; y: number; radius: number } | null>(
    null,
  );
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  const commit = useCallback((next: Network) => networkStore.set(next), []);
  const done = useCallback(() => setFlood(null), []);

  const switchNetwork = useCallback<SwitchNetwork>(
    (next, from) => {
      if (next === networkStore.get()) return;
      fire("toggle");
      const target = themeFor(theme.mode, next);
      const { width, height } = Dimensions.get("window");
      const x = from?.x ?? width / 2;
      const y = from?.y ?? height / 2;
      const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
      setFlood({ color: target.color.background, glow: target.color.glow, x, y, radius });
      if (reduced) {
        scale.value = 1;
        opacity.value = withTiming(1, { duration: MOTION.durations.reducedMotion }, () => {
          runOnJS(commit)(next);
          opacity.value = withTiming(0, { duration: MOTION.durations.reducedMotion }, () => runOnJS(done)());
        });
        return;
      }
      scale.value = 0;
      opacity.value = 1;
      scale.value = withTiming(1, { duration: MOTION.durations.networkFlood, easing: EASING.flood }, () => {
        runOnJS(commit)(next);
        opacity.value = withTiming(0, { duration: MOTION.durations.floodSettle }, () => runOnJS(done)());
      });
    },
    [theme.mode, reduced, scale, opacity, commit, done],
  );

  const circle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <FloodContext.Provider value={switchNetwork}>
      {children}
      {flood ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.circle,
            {
              left: flood.x - flood.radius,
              top: flood.y - flood.radius,
              width: flood.radius * 2,
              height: flood.radius * 2,
              borderRadius: flood.radius,
              backgroundColor: flood.color,
              borderColor: flood.glow,
              borderWidth: RIM,
              boxShadow: `0px 0px ${GLOW_BLUR}px ${RIM}px ${flood.glow}`,
            },
            circle,
          ]}
        />
      ) : null}
    </FloodContext.Provider>
  );
}

const styles = StyleSheet.create({ circle: { position: "absolute" } });
