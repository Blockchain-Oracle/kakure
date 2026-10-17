import { type ReactNode, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDockClearance } from "@/shell/dock";
import { ModeCapsule } from "@/shell/mode-capsule";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { Txt } from "./text";

/**
 * A dock page: the page title in Roboto Condensed Black, the mode capsule on the trailing edge, content in the
 * 20 pt gutter, and bottom padding so nothing hides under the floating dock. One hero figure per surface.
 */
function styles(theme: Theme) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.color.background },
    content: { paddingHorizontal: theme.space.inset, gap: theme.space.lg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.space.md,
      paddingBottom: theme.space.sm,
    },
    trailing: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  });
}

export interface ScreenProps {
  title: string;
  children: ReactNode;
  trailing?: ReactNode;
  showCapsule?: boolean;
  /**
   * Pull to refresh. The spinner follows the user's pull only, until the returned promise settles. Background work
   * (the sync clock, query refetches) shows in the page's own status pills instead: on iOS a programmatic
   * `refreshing` moves the content offset up by the spinner's height (RN's beginRefreshingProgrammatically), and a
   * tab that is detached when it ends never gets it back, so each background sync pushed the Wallet page 60 pt down
   * until it was blank.
   */
  onRefresh?: () => unknown;
  dock?: boolean;
}

export function Screen({ title, children, trailing, showCapsule = true, onRefresh, dock = true }: ScreenProps) {
  const theme = useTheme();
  const [pulling, setPulling] = useState(false);
  const pull = () => {
    if (!onRefresh) return;
    setPulling(true);
    void Promise.resolve()
      .then(onRefresh)
      .catch(() => undefined)
      .finally(() => setPulling(false));
  };
  const s = useThemed(styles);
  const insets = useSafeAreaInsets();
  const clearance = useDockClearance();
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[
        s.content,
        { paddingTop: insets.top + theme.space.md, paddingBottom: dock ? clearance : insets.bottom + theme.space.xl },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={pulling} onRefresh={pull} tintColor={theme.color.mutedForeground} />
        ) : undefined
      }
    >
      <View style={s.header}>
        <Txt variant="pageTitle" accessibilityRole="header">
          {title}
        </Txt>
        <View style={s.trailing}>
          {trailing}
          {showCapsule ? <ModeCapsule /> : null}
        </View>
      </View>
      {children}
    </ScrollView>
  );
}

/** A sheet's body: sheet padding and the sheet title (sheets are native form sheets). */
export function SheetBody({ title, children, subtitle }: { title: string; subtitle?: string; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={{
        padding: theme.space.lgPlus,
        paddingBottom: insets.bottom + theme.space.xl,
        gap: theme.space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: theme.space.xs }}>
        <Txt variant="sheetTitle" accessibilityRole="header">
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="rowDetail" tone="muted">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {children}
    </ScrollView>
  );
}
