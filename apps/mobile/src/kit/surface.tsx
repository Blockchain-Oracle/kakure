import { ChevronRight, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { PressScale } from "./press";
import { Txt } from "./text";

/**
 * Plates and rows (kawase.md §4.2): depth is one step lighter fill, never a border or a shadow. A group on a page is
 * a card plate (radius 20); a group inside a sheet is raised-2.
 */
function styles(theme: Theme) {
  return StyleSheet.create({
    plate: {
      backgroundColor: theme.color.card,
      borderRadius: theme.radius.group,
      padding: theme.space.lg,
      gap: theme.space.md,
    },
    raised: {
      backgroundColor: theme.color.raised2,
      borderRadius: theme.radius.group,
      padding: theme.space.lg,
      gap: theme.space.md,
    },
    rule: { height: theme.size.hairline, backgroundColor: theme.color.rowPressed },
    fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.space.md },
    factValue: { flexShrink: 1 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      minHeight: theme.size.rowMinHeight,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.md,
      backgroundColor: theme.color.card,
      borderRadius: theme.radius.group,
    },
    rowText: { flex: 1, gap: theme.space.xxs },
    icon: {
      width: theme.size.avatarMd,
      height: theme.size.avatarMd,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    section: { gap: theme.space.sm },
  });
}

export function Plate({ style, raised = false, ...rest }: ViewProps & { raised?: boolean }) {
  const s = useThemed(styles);
  return <View {...rest} style={[raised ? s.raised : s.plate, style]} />;
}

export function Rule() {
  const s = useThemed(styles);
  return <View style={s.rule} />;
}

/** A fact: label left in meta/text-2, value right in rowStrong (the receipt and review grammar). */
export function Fact({
  label,
  value,
  tone = "foreground",
}: {
  label: string;
  value: ReactNode;
  tone?: "foreground" | "up" | "down" | "warn" | "muted";
}) {
  const s = useThemed(styles);
  return (
    <View style={s.fact}>
      <Txt variant="rowDetail" tone="muted">
        {label}
      </Txt>
      {typeof value === "string" ? (
        <Txt variant="rowStrong" tone={tone} align="right" style={s.factValue}>
          {value}
        </Txt>
      ) : (
        value
      )}
    </View>
  );
}

export interface RowProps {
  title: string;
  detail?: string;
  icon?: LucideIcon;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  accessibilityHint?: string;
}

export function Row({
  title,
  detail,
  icon: Icon,
  leading,
  trailing,
  onPress,
  chevron = Boolean(onPress),
  accessibilityHint,
}: RowProps) {
  const theme = useTheme();
  const s = useThemed(styles);
  const body = (
    <>
      {leading ??
        (Icon ? (
          <View style={s.icon}>
            <Icon color={theme.color.foreground} size={theme.size.railIcon} strokeWidth={theme.size.iconStroke} />
          </View>
        ) : null)}
      <View style={s.rowText}>
        <Txt variant="rowTitle">{title}</Txt>
        {detail ? (
          <Txt variant="rowDetail" tone="muted">
            {detail}
          </Txt>
        ) : null}
      </View>
      {trailing}
      {chevron ? <ChevronRight color={theme.color.text3} size={theme.size.railIcon} /> : null}
    </>
  );
  if (!onPress) return <View style={s.row}>{body}</View>;
  return (
    <PressScale onPress={onPress} style={s.row} accessibilityLabel={title} accessibilityHint={accessibilityHint}>
      {body}
    </PressScale>
  );
}

/** A labelled group of rows (sentence case, no tracked uppercase labels). */
export function Section({ label, children }: { label?: string; children: ReactNode }) {
  const s = useThemed(styles);
  return (
    <View style={s.section}>
      {label ? (
        <Txt variant="label" tone="text3">
          {label}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}
