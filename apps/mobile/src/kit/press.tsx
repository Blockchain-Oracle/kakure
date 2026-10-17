import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { haptic } from "@/feedback/fire";
import { MOTION } from "@/theme/theme";
import { useMotionReduced } from "@/theme/theme-provider";

/**
 * A plate that goes down when pressed: scale 0.97 in 100 ms, back in 160 ms (kawase.md §4.6), with a haptic word.
 * Motion on the wrapper, colour on the inner view.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressScaleProps extends Omit<PressableProps, "style" | "children"> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  feedback?: "tick" | "press" | false;
}

export function PressScale({
  style,
  children,
  feedback = "tick",
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: PressScaleProps) {
  const scale = useSharedValue(1);
  const reduced = useMotionReduced();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      onPressIn={(event) => {
        if (!reduced) scale.value = withTiming(MOTION.scales.press, { duration: MOTION.durations.pressIn });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withTiming(1, { duration: MOTION.durations.pressOut });
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (feedback) haptic(feedback);
        onPress?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
