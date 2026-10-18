import { router } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { MIN_SEED_WORDS, NETWORK_LABEL } from "@/constants";
import { Button } from "@/kit/button";
import { SheetBody } from "@/kit/screen";
import { Strip } from "@/kit/states";
import { Txt } from "@/kit/text";
import { useNetwork } from "@/network/network-store";
import { onboardedStore } from "@/onboarding/onboarded";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { restoreWallet } from "@/wallet/wallet-store";

/**
 * Restore from a recovery phrase (C10). The words go straight to the wallet module and its keystore; screenshots
 * are blocked here. A birthday height makes the first sync faster; without one it scans from the library birthday.
 */
function styles(theme: Theme) {
  return StyleSheet.create({
    input: {
      minHeight: theme.size.fieldHeight * 2,
      borderRadius: theme.radius.group,
      backgroundColor: theme.color.input,
      padding: theme.space.lg,
      color: theme.color.foreground,
      ...theme.text.field,
      textAlignVertical: "top",
    },
    field: {
      height: theme.size.inputHeight,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.input,
      paddingHorizontal: theme.space.lg,
      color: theme.color.foreground,
      ...theme.text.field,
    },
    gap: { gap: theme.space.sm },
  });
}

export default function Restore() {
  usePreventScreenCapture("restore");
  const theme = useTheme();
  const s = useThemed(styles);
  const network = useNetwork();
  const [phrase, setPhrase] = useState("");
  const [birthday, setBirthday] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const words = phrase.trim().split(/\s+/).filter(Boolean).length;

  const restore = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await restoreWallet(network, phrase.trim(), Number.parseInt(birthday, 10) || 0);
      onboardedStore.set(true);
      router.replace("/lock-offer");
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetBody
      secret
      title="Restore a wallet"
      subtitle={`${NETWORK_LABEL[network]} · type your words in order, separated by spaces.`}
    >
      <TextInput
        style={s.input}
        value={phrase}
        onChangeText={setPhrase}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        secureTextEntry={false}
        placeholder="word word word…"
        placeholderTextColor={theme.color.text3}
        accessibilityLabel="Recovery phrase"
      />
      <View style={s.gap}>
        <Txt variant="label" tone="muted">
          Birthday height (optional)
        </Txt>
        <TextInput
          style={s.field}
          value={birthday}
          onChangeText={setBirthday}
          keyboardType="number-pad"
          placeholder="e.g. 4512225"
          placeholderTextColor={theme.color.text3}
          accessibilityLabel="Birthday height"
        />
      </View>
      <Strip>Restored Orchard funds can be moved to Ironwood from the Wallet tab before betting.</Strip>
      {problem ? (
        <Txt variant="rowDetail" tone="destructive">
          {problem}
        </Txt>
      ) : null}
      <Button
        label={words < MIN_SEED_WORDS ? "Enter your 12 to 24 words" : busy ? "Restoring…" : "Restore"}
        busy={busy}
        onPress={() => {
          if (words >= MIN_SEED_WORDS) void restore();
        }}
      />
    </SheetBody>
  );
}
