import { Canvas, DashPathEffect, Line, Path, Skia, vec } from "@shopify/react-native-skia";
import { useMemo } from "react";
import type { Sample } from "@/data/price-history";
import { useTheme } from "@/theme/theme-provider";

/**
 * A price line drawn with Skia (Senryo's phone chart, simplified): the samples seen since the app opened, the
 * opening reference as a dashed line, and the line coloured by which side of the reference it is on (with the
 * Up/Down words beside it on screen: never colour alone).
 */
const STROKE = 2;
const PAD = 4;
const DASH_ON = 4;
const DASH: number[] = [DASH_ON, DASH_ON];
/** A flat line still needs a span to draw: a hair of the price. */
const MIN_SPAN = 1e-9;
const FLAT_SPAN_FRACTION = 1e-4;

export function LineChart({
  samples,
  width,
  height,
  reference,
}: {
  samples: readonly Sample[];
  width: number;
  height: number;
  reference: number | null;
}) {
  const theme = useTheme();
  const { path, refY, last } = useMemo(() => {
    const values = samples.map((sample) => sample.price);
    if (reference !== null) values.push(reference);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || Math.max(MIN_SPAN, Math.abs(high) * FLAT_SPAN_FRACTION);
    const y = (price: number) => PAD + (height - PAD * 2) * (1 - (price - low) / span);
    const first = samples[0]?.at ?? 0;
    const end = samples[samples.length - 1]?.at ?? first + 1;
    const x = (at: number) => PAD + (width - PAD * 2) * ((at - first) / Math.max(1, end - first));
    // Skia 2.14 paths are immutable: build with PathBuilder.
    const builder = Skia.PathBuilder.Make();
    samples.forEach((sample, index) => {
      if (index === 0) builder.moveTo(x(sample.at), y(sample.price));
      else builder.lineTo(x(sample.at), y(sample.price));
    });
    return {
      path: builder.build(),
      refY: reference === null ? null : y(reference),
      last: samples[samples.length - 1]?.price ?? null,
    };
  }, [samples, width, height, reference]);

  const above = reference === null || last === null ? null : last >= reference;
  const color = above === null ? theme.color.foreground : above ? theme.color.up : theme.color.down;
  return (
    <Canvas style={{ width, height }}>
      {refY !== null ? (
        <Line p1={vec(0, refY)} p2={vec(width, refY)} color={theme.color.text3} strokeWidth={1}>
          <DashPathEffect intervals={DASH} />
        </Line>
      ) : null}
      {samples.length > 1 ? (
        <Path path={path} color={color} style="stroke" strokeWidth={STROKE} strokeJoin="round" strokeCap="round" />
      ) : null}
    </Canvas>
  );
}
