import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { RobotoCondensed_900Black } from "@expo-google-fonts/roboto-condensed";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SHEET_DETENTS } from "@/constants";
import { DataProvider } from "@/data/data-provider";
import { warmSounds } from "@/feedback/fire";
import { keepAppDataOutOfBackups } from "@/lib/no-backup";
import { FloodProvider } from "@/network/flood";
import { useNotificationsForTickets } from "@/notifications/schedule";
import { onboardedStore } from "@/onboarding/onboarded";
import { LockGate } from "@/shell/lock-gate";
import { ThemeProvider, useTheme } from "@/theme/theme-provider";
import { useTicketTracker } from "@/tickets/tracker";
import { startWallet } from "@/wallet/wallet-store";

void SplashScreen.preventAutoHideAsync();

/** Stack screens; sheets are native form sheets (the dock hides under them, kawase.md §4.5). */
function Navigator() {
  const theme = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.color.background);
  }, [theme.color.background]);
  useTicketTracker();
  useNotificationsForTickets();
  const sheet = {
    presentation: "formSheet" as const,
    sheetGrabberVisible: true,
    sheetCornerRadius: theme.radius.sheet,
    contentStyle: { backgroundColor: theme.color.background },
  };
  return (
    <>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(onboarding)" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="market/[id]"
          options={{ headerShown: true, title: "", headerTransparent: true, headerBackButtonDisplayMode: "minimal" }}
        />
        {/* Sized to the form, so the bet action is on screen the moment the sheet opens (a numeric first
            detent cut it off). Where the form is taller than the screen, the sheet stops at full height and
            SheetBody's scroll view, which react-native-screens sizes to the sheet, scrolls to it. */}
        <Stack.Screen name="bet" options={{ ...sheet, sheetAllowedDetents: "fitToContents" }} />
        <Stack.Screen name="pay-qr" options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.form] }} />
        <Stack.Screen
          name="network"
          options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.medium, SHEET_DETENTS.tall] }}
        />
        <Stack.Screen
          name="ticket/[hash]"
          options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.tall, SHEET_DETENTS.full] }}
        />
        <Stack.Screen name="receive" options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.tall] }} />
        <Stack.Screen name="send" options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.form] }} />
        <Stack.Screen name="migrate" options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.medium] }} />
        <Stack.Screen name="backup" options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.form] }} />
        <Stack.Screen
          name="transfer-file"
          options={{ ...sheet, sheetAllowedDetents: [SHEET_DETENTS.medium, SHEET_DETENTS.form] }}
        />
        <Stack.Screen name="scan" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen
          name="activity"
          options={{ headerShown: true, title: "Activity", headerBackButtonDisplayMode: "minimal" }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    RobotoCondensed_900Black,
  });

  useEffect(() => {
    keepAppDataOutOfBackups();
    warmSounds();
    // The wallet opens only after first run made (or found) one; onboarding starts it itself.
    if (onboardedStore.get()) return startWallet();
    return onboardedStore.subscribe(() => {
      if (onboardedStore.get()) startWallet();
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <DataProvider>
            <FloodProvider>
              <LockGate>
                <Navigator />
              </LockGate>
            </FloodProvider>
          </DataProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
