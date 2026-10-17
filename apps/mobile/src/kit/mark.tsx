import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useTheme } from "@/theme/theme-provider";
import { Txt } from "./text";

/**
 * A real mark in its own colours, clipped round (R4: "nothing is tinted"). Without one it is the labelled neutral
 * disc, never a stand-in logo (kawase.md §4.7).
 */
export function Mark({ svg, symbol, size }: { svg: string | null; symbol: string; size: number }) {
  const theme = useTheme();
  const disc = { width: size, height: size, borderRadius: size / 2 };
  if (svg) {
    return (
      <View style={[styles.clip, disc]} accessibilityLabel={symbol}>
        <SvgXml xml={svg} width={size} height={size} />
      </View>
    );
  }
  return (
    <View
      style={[styles.clip, styles.neutral, disc, { backgroundColor: theme.color.secondary }]}
      accessibilityLabel={symbol}
    >
      <Txt variant="label" tone="muted">
        {symbol.slice(0, DISC_LETTERS)}
      </Txt>
    </View>
  );
}

/** The neutral disc shows at most this many letters of the symbol. */
const DISC_LETTERS = 4;

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  neutral: { alignItems: "center", justifyContent: "center" },
});
