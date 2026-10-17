import { Stack } from "expo-router";
import { useTheme } from "@/theme/theme-provider";

/** First run: the promise, a wallet (create or restore), its backup, and the lock offer. */
export default function OnboardingLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.background } }} />;
}
