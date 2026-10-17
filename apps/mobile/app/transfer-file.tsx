import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { EXPORT_FILE_EXTENSION, EXPORT_MIN_PASSPHRASE, NETWORK_LABEL } from "@/constants";
import { fire } from "@/feedback/fire";
import { Button } from "@/kit/button";
import { SheetBody } from "@/kit/screen";
import { Strip } from "@/kit/states";
import { Txt } from "@/kit/text";
import { useNetwork } from "@/network/network-store";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { exportTickets, importTickets } from "@/tickets/export";

/**
 * Export or import this network's tickets (R6): an AES-GCM file sealed with your passphrase, the same format as the
 * web app. The passphrase isn't stored anywhere; without it the file can't be opened.
 */
function styles(theme: Theme) {
  return StyleSheet.create({
    field: {
      height: theme.size.inputHeight,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.input,
      paddingHorizontal: theme.space.lg,
      color: theme.color.foreground,
      ...theme.text.field,
    },
  });
}

export default function TransferFile() {
  const theme = useTheme();
  const s = useThemed(styles);
  const { mode } = useLocalSearchParams<{ mode?: "export" | "import" }>();
  const network = useNetwork();
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const importing = mode === "import";

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (importing) {
        const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
        if (picked.canceled || !picked.assets[0]) return;
        const count = await importTickets(network, await new File(picked.assets[0].uri).text(), passphrase);
        fire("confirmed");
        setNote(`Imported ${count} ${NETWORK_LABEL[network]} tickets.`);
      } else {
        const { text, count } = await exportTickets(network, passphrase);
        const day = new Date().toISOString().slice(0, "yyyy-mm-dd".length);
        const file = new File(Paths.cache, `kakure-tickets-${network}-${day}${EXPORT_FILE_EXTENSION}`);
        file.create({ overwrite: true });
        file.write(text);
        await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Save your ticket file" });
        setNote(`${count} tickets sealed. Keep the file and the passphrase apart.`);
      }
    } catch (error) {
      fire("error");
      setNote((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tooShort = passphrase.length < EXPORT_MIN_PASSPHRASE;
  const mismatch = !importing && passphrase !== again;
  const label = tooShort
    ? `Use at least ${EXPORT_MIN_PASSPHRASE} characters`
    : mismatch
      ? "The passphrases don't match"
      : importing
        ? "Choose the file"
        : busy
          ? "Sealing…"
          : "Seal and save";

  return (
    <SheetBody
      title={importing ? "Import tickets" : "Export tickets"}
      subtitle={`${NETWORK_LABEL[network]} tickets only. Sealed with your passphrase on this phone.`}
    >
      <TextInput
        style={s.field}
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        placeholder="Passphrase"
        placeholderTextColor={theme.color.text3}
        accessibilityLabel="Passphrase"
      />
      {!importing ? (
        <TextInput
          style={s.field}
          value={again}
          onChangeText={setAgain}
          secureTextEntry
          placeholder="Passphrase again"
          placeholderTextColor={theme.color.text3}
          accessibilityLabel="Passphrase again"
        />
      ) : null}
      {note ? <Strip>{note}</Strip> : null}
      <Button label={label} busy={busy} onPress={() => (tooShort || mismatch ? undefined : void run())} />
      <Txt variant="meta" tone="text3">
        Sealing takes a few seconds on purpose: the key stretching makes a guessed passphrase slow to test.
      </Txt>
      <Button label="Close" variant="quiet" size="sm" onPress={() => router.back()} />
    </SheetBody>
  );
}
