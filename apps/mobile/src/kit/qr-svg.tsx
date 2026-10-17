import { useMemo } from "react";
import Svg, { G, Path, Rect } from "react-native-svg";
import { encode } from "uqr";
import { useTheme } from "@/theme/theme-provider";

/**
 * The dotted QR drawn with react-native-svg, for places captured as an image with view-shot (the receipt stub):
 * view-shot reliably captures native views, and its docs don't promise a Skia canvas. Same geometry as DottedQr.
 */
const FINDER = 7;
const DOT = 0.5;
const HALF = 2;
const RING = 1;
const OUTER_RADIUS = 2;
const INNER_RADIUS = 1;
const CORE_OFFSET = 2;
const CORE = 3;
/** White margin around the code, in modules (the slip's paper adds the rest of the quiet zone). */
const MARGIN = 2;

export function QrSvg({ value, size, ecc = "M" }: { value: string; size: number; ecc?: "L" | "M" | "Q" | "H" }) {
  const theme = useTheme();
  const qr = useMemo(() => encode(value, { ecc, border: 0 }), [value, ecc]);
  const n = qr.size;
  const path = useMemo(() => {
    let d = "";
    const finder = (x: number, y: number) =>
      (x < FINDER && y < FINDER) || (x >= n - FINDER && y < FINDER) || (x < FINDER && y >= n - FINDER);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (!qr.data[y]?.[x] || finder(x, y)) continue;
        d += `M${x} ${y + DOT}a${DOT} ${DOT} 0 1 0 ${DOT * HALF} 0a${DOT} ${DOT} 0 1 0 ${-DOT * HALF} 0`;
      }
    }
    return d;
  }, [qr, n]);
  const ink = theme.color.paperInk;
  return (
    <Svg width={size} height={size} viewBox={`${-MARGIN} ${-MARGIN} ${n + MARGIN * 2} ${n + MARGIN * 2}`}>
      <Rect x={-MARGIN} y={-MARGIN} width={n + MARGIN * 2} height={n + MARGIN * 2} fill={theme.color.paper} />
      <Path d={path} fill={ink} />
      {[
        [0, 0],
        [n - FINDER, 0],
        [0, n - FINDER],
      ].map(([x = 0, y = 0]) => (
        <G key={`${x}-${y}`}>
          <Rect
            x={x + RING / HALF}
            y={y + RING / HALF}
            width={FINDER - RING}
            height={FINDER - RING}
            rx={OUTER_RADIUS}
            stroke={ink}
            strokeWidth={RING}
            fill="none"
          />
          <Rect x={x + CORE_OFFSET} y={y + CORE_OFFSET} width={CORE} height={CORE} rx={INNER_RADIUS} fill={ink} />
        </G>
      ))}
    </Svg>
  );
}
