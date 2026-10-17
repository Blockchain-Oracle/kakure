import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ title: "Kakure · S00 wallet smoke" }} />
      <StatusBar style="auto" />
    </>
  );
}
