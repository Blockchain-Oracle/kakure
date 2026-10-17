import { Tabs } from "expo-router";
import { Dock } from "@/shell/dock";
import { useTheme } from "@/theme/theme-provider";

/** The dock pages: Markets · Portfolio · Wallet · Settings. */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      tabBar={(props) => <Dock {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.color.background } }}
    >
      <Tabs.Screen name="markets" options={{ title: "Markets" }} />
      <Tabs.Screen name="portfolio" options={{ title: "Portfolio" }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
