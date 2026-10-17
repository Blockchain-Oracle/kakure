import { Check } from "lucide-react-native";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { MOTION, type Theme } from "@/theme/theme";
import { useMotionReduced, useTheme, useThemed } from "@/theme/theme-provider";
import { Txt } from "./text";

/**
 * TxSteps (kawase.md §3.3): a check when done, a pulse when active, a hollow ring when pending; a failed step says
 * so in words. Several steps can be active at once when one native call does both (prove + send privately).
 */
export type StepState = "done" | "active" | "pending" | "failed";

export interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

const DOT = 18;
const PULSE_LOW = 0.3;

function styles(theme: Theme) {
  return StyleSheet.create({
    list: { gap: theme.space.md },
    row: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
    dot: { width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: "center", justifyContent: "center" },
    done: { backgroundColor: theme.color.foreground },
    active: { backgroundColor: theme.color.accent },
    pending: { borderWidth: 2, borderColor: theme.color.border },
    failed: { backgroundColor: theme.color.destructive },
    text: { flex: 1 },
  });
}

function Dot({ state }: { state: StepState }) {
  const theme = useTheme();
  const s = useThemed(styles);
  const reduced = useMotionReduced();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (state !== "active" || reduced) {
      opacity.value = 1;
      return;
    }
    const half = MOTION.durations.skeletonPeriod / 2;
    opacity.value = withRepeat(
      withSequence(withTiming(PULSE_LOW, { duration: half }), withTiming(1, { duration: half })),
      -1,
    );
  }, [state, reduced, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[s.dot, s[state], animated]}>
      {state === "done" ? <Check color={theme.color.background} size={12} strokeWidth={3} /> : null}
    </Animated.View>
  );
}

export function TxSteps({ steps }: { steps: readonly Step[] }) {
  const s = useThemed(styles);
  return (
    <View style={s.list} accessibilityRole="list">
      {steps.map((step) => (
        <View key={step.label} style={s.row} accessibilityLabel={`${step.label}: ${step.state}`}>
          <Dot state={step.state} />
          <View style={s.text}>
            <Txt
              variant={step.state === "active" ? "rowStrong" : "row"}
              tone={step.state === "pending" ? "muted" : step.state === "failed" ? "destructive" : "foreground"}
            >
              {step.label}
            </Txt>
            {step.detail ? (
              <Txt variant="meta" tone="muted">
                {step.detail}
              </Txt>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}
