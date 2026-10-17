import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { ScanFace } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState } from "@/kit/states";
import { onboardedStore } from "@/onboarding/onboarded";
import { setPrefs } from "@/settings/prefs";
import { useTheme } from "@/theme/theme-provider";

/** The biometric lock offer at the end of first run (C10). It can be turned on or off later in Settings. */
export default function LockOffer() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState("Ask for Face ID or your passcode when Kakure opens.");

  const finish = () => {
    onboardedStore.set(true);
    router.replace("/markets");
  };

  const enable = async () => {
    const enrolled = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) {
      setNote("This phone has no Face ID or Touch ID set up. You can turn the lock on in Settings once it does.");
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Turn on the Kakure lock" });
    if (result.success) {
      setPrefs({ biometricLock: true });
      finish();
    }
  };

  return (
    <View
      style={{ flex: 1, justifyContent: "center", paddingTop: insets.top, backgroundColor: theme.color.background }}
    >
      <EmptyState
        icon={ScanFace}
        title="Lock Kakure"
        reason={note}
        action={{ label: "Use Face ID", onPress: () => void enable() }}
        secondary={{ label: "Not now", onPress: finish }}
      />
    </View>
  );
}
