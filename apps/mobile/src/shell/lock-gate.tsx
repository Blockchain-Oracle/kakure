import * as LocalAuthentication from "expo-local-authentication";
import { Lock } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { Button } from "@/kit/button";
import { Txt } from "@/kit/text";
import { usePrefs } from "@/settings/prefs";
import { useTheme } from "@/theme/theme-provider";

/**
 * The biometric lock (C10): with the lock on, the app asks for Face ID / Touch ID (or the device passcode) when it
 * opens and when it returns after a minute away. Nothing behind it renders while locked.
 */
const RELOCK_AFTER_MS = 60_000;

export function LockGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { biometricLock } = usePrefs();
  const [locked, setLocked] = useState(biometricLock);
  const [failed, setFailed] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setFailed(false);
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Kakure" }).catch(() => ({
      success: false,
    }));
    if (result.success) setLocked(false);
    else setFailed(true);
  }, []);

  useEffect(() => {
    if (!biometricLock) {
      setLocked(false);
      return;
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") hiddenAt.current = Date.now();
      if (state === "active" && hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) setLocked(true);
    });
    return () => sub.remove();
  }, [biometricLock]);

  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (!locked) return <>{children}</>;
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.center,
        { backgroundColor: theme.color.background, gap: theme.space.lg, padding: theme.space.xl },
      ]}
    >
      <Lock color={theme.color.foreground} size={theme.size.avatarMd} />
      <Txt variant="title" align="center">
        Kakure is locked
      </Txt>
      <Txt variant="body" tone="muted" align="center">
        {failed ? "That didn't unlock it. Try again, or use your passcode." : "Unlock with Face ID or your passcode."}
      </Txt>
      <Button label="Unlock" onPress={() => void unlock()} />
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: "center", justifyContent: "center" } });
