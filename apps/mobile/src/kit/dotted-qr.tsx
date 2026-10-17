import { Canvas, Group, Path, Rect, RoundedRect, Skia, useCanvasRef } from "@shopify/react-native-skia";
import { type Ref, useEffect, useImperativeHandle, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { encode } from "uqr";
import { EASING, MOTION } from "@/theme/theme";
import { useMotionReduced, useTheme } from "@/theme/theme-provider";

/**
 * Kawase's DottedQr (kawase.md §8.3), drawn with Skia: dots at 0.5 of a module (the radius that decoded), finders
 * as rounded rings, always paper-ink on the paper plate so it scans in every theme. The bet QR uses error
 * correction M and no centre mark (plan §7). The code reveals in 650 ms (a fade and settle; still under reduced
 * motion). `ref.snapshot()` returns the plate as a base64 PNG for "Save QR image".
 */
export interface DottedQrHandle {
  snapshot(): string | null;
}

const FINDER = 7;
const DOT_RADIUS = 0.5;
const FINDER_OUTER_RADIUS = 2;
const FINDER_INNER_RADIUS = 1;
const FINDER_RING = 1;
const FINDER_CORE_OFFSET = 2;
const FINDER_CORE = 3;
const HALF = 2;
/** Quiet zone around the code, in modules (ISO/IEC 18004 asks for four). */
const QUIET = 4;
const REVEAL_FROM = 0.94;

function inFinder(x: number, y: number, n: number): boolean {
  return (x < FINDER && y < FINDER) || (x >= n - FINDER && y < FINDER) || (x < FINDER && y >= n - FINDER);
}

export function DottedQr({
  value,
  size,
  ecc = "M",
  label,
  ref,
}: {
  value: string;
  size: number;
  ecc?: "L" | "M" | "Q" | "H";
  /** Accessible name; never the encoded value (a bet request is a bearer secret). */
  label: string;
  ref?: Ref<DottedQrHandle>;
}) {
  const theme = useTheme();
  const reduced = useMotionReduced();
  const canvas = useCanvasRef();
  const qr = useMemo(() => encode(value, { ecc, border: 0 }), [value, ecc]);
  const n = qr.size;
  const scale = size / (n + QUIET * HALF);

  const dots = useMemo(() => {
    let svg = "";
    for (let y = 0; y < n; y += 1) {
      const row = qr.data[y] ?? [];
      for (let x = 0; x < n; x += 1) {
        if (!row[x] || inFinder(x, y, n)) continue;
        svg += `M${x} ${y + DOT_RADIUS}a${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${DOT_RADIUS * HALF} 0a${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${-DOT_RADIUS * HALF} 0`;
      }
    }
    return Skia.Path.MakeFromSVGString(svg);
  }, [qr, n]);

  useImperativeHandle(ref, () => ({
    snapshot: () => canvas.current?.makeImageSnapshot()?.encodeToBase64() ?? null,
  }));

  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    progress.value = 0;
    progress.value = reduced ? 1 : withTiming(1, { duration: MOTION.durations.qrReveal, easing: EASING.default });
  }, [value, reduced, progress]);
  const reveal = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: REVEAL_FROM + (1 - REVEAL_FROM) * progress.value }],
  }));

  const ink = theme.color.paperInk;
  const finders = [
    [0, 0],
    [n - FINDER, 0],
    [0, n - FINDER],
  ] as const;

  return (
    <Animated.View style={[{ width: size, height: size }, reveal]} accessibilityRole="image" accessibilityLabel={label}>
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.paper, borderRadius: theme.radius.group }]}
      />
      <Canvas ref={canvas} style={{ width: size, height: size }}>
        <Rect x={0} y={0} width={size} height={size} color={theme.color.paper} />
        <Group transform={[{ translateX: QUIET * scale }, { translateY: QUIET * scale }, { scale }]}>
          {dots ? <Path path={dots} color={ink} /> : null}
          {finders.map(([fx, fy]) => (
            <Group key={`${fx}-${fy}`}>
              <RoundedRect
                x={fx + FINDER_RING / HALF}
                y={fy + FINDER_RING / HALF}
                width={FINDER - FINDER_RING}
                height={FINDER - FINDER_RING}
                r={FINDER_OUTER_RADIUS}
                color={ink}
                style="stroke"
                strokeWidth={FINDER_RING}
              />
              <RoundedRect
                x={fx + FINDER_CORE_OFFSET}
                y={fy + FINDER_CORE_OFFSET}
                width={FINDER_CORE}
                height={FINDER_CORE}
                r={FINDER_INNER_RADIUS}
                color={ink}
              />
            </Group>
          ))}
        </Group>
      </Canvas>
    </Animated.View>
  );
}
