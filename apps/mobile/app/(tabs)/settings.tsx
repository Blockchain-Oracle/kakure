import { OPERATOR_PUBLIC_KEYS } from "@kakure/query";
import * as Application from "expo-application";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import {
  Download,
  Globe,
  KeyRound,
  Lock,
  MonitorSmartphone,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react-native";
import { useState } from "react";
import { Alert, Switch, View } from "react-native";
import { NETWORK_LABEL, WALLET_PRIVACY_LINE, WALLET_SERVERS, type WalletServerId } from "@/constants";
import { Segmented } from "@/kit/controls";
import { Screen } from "@/kit/screen";
import { Strip } from "@/kit/states";
import { Row, Section } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { useNetwork } from "@/network/network-store";
import { forgetThisDevice } from "@/settings/forget";
import { type Prefs, setPrefs, usePrefs } from "@/settings/prefs";
import { useTheme } from "@/theme/theme-provider";
import { switchWalletServer, walletServerFor } from "@/wallet/wallet-store";

/**
 * Settings (surfaces.md Mobile → Settings): sound, haptics, motion, privacy eye, appearance, the lock, network,
 * connection guidance, ticket export/import, updates (checked only when asked), the operator key, Forget this device.
 */
const FINGERPRINT = 16;

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Row
      title={label}
      {...(detail ? { detail } : {})}
      trailing={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: theme.color.accent, false: theme.color.secondary }}
          thumbColor={theme.color.card}
          accessibilityLabel={label}
        />
      }
    />
  );
}

export default function SettingsTab() {
  const theme = useTheme();
  const prefs = usePrefs();
  const network = useNetwork();
  const [update, setUpdate] = useState<string | null>(null);
  const key = OPERATOR_PUBLIC_KEYS[network];

  const toggleLock = async (next: boolean) => {
    if (!next) {
      setPrefs({ biometricLock: false });
      return;
    }
    if (!((await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()))) {
      Alert.alert("No Face ID or Touch ID", "Set one up in the phone's Settings first.");
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Turn on the Kakure lock" });
    if (result.success) setPrefs({ biometricLock: true });
  };

  const checkUpdates = async () => {
    if (__DEV__ || !Updates.isEnabled) {
      setUpdate("This is a development build: it loads code from the dev server, so there's nothing to update.");
      return;
    }
    setUpdate("Checking…");
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setUpdate("You're on the latest version.");
        return;
      }
      setUpdate("Downloading the update…");
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (error) {
      setUpdate(`The check didn't finish: ${(error as Error).message}`);
    }
  };

  const forget = () =>
    Alert.alert(
      "Forget this device?",
      "This deletes both wallets, every ticket and all settings from this phone. Funds stay on chain; only your recovery words bring them back.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            void forgetThisDevice().then(() => router.replace("/welcome"));
          },
        },
      ],
    );

  const set = (patch: Partial<Prefs>) => setPrefs(patch);
  const servers = WALLET_SERVERS[network];
  const server = walletServerFor(network);

  return (
    <Screen title="Settings">
      <Section label="Feedback">
        <Toggle
          label="Sounds"
          detail="For money and outcomes; never for taps"
          value={prefs.sound}
          onChange={(sound) => set({ sound })}
        />
        <Toggle label="Haptics" value={prefs.haptics} onChange={(haptics) => set({ haptics })} />
        <Toggle
          label="Reduce motion"
          detail="Crossfades instead of travel"
          value={prefs.motion === "reduce"}
          onChange={(reduce) => set({ motion: reduce ? "reduce" : "system" })}
        />
      </Section>

      <Section label="Privacy">
        <Row
          icon={MonitorSmartphone}
          title="What servers see"
          detail={`${WALLET_PRIVACY_LINE} That server also learns when this wallet was made and which transactions it fetches. Kakure itself only downloads signed public files, the same for everyone. For Tor on the whole phone, use Orbot's VPN mode.`}
        />
        {servers.length > 1 ? (
          <View style={{ gap: theme.space.sm }}>
            <Txt variant="label" tone="muted">
              {NETWORK_LABEL[network]} wallet server
            </Txt>
            <Segmented<WalletServerId>
              label={`${NETWORK_LABEL[network]} wallet server`}
              value={server.id}
              onChange={(id) => void switchWalletServer(network, id)}
              options={servers.map((option) => ({ value: option.id, label: option.label }))}
            />
            <Txt variant="meta" tone="muted">
              Two operators. Switching re-opens the wallet on the new server, which then sees your IP instead.
            </Txt>
          </View>
        ) : (
          <Row icon={Server} title={server.label} detail={`The only public ${NETWORK_LABEL[network]} wallet server`} />
        )}
        <Toggle
          label="Hide amounts"
          detail="The privacy eye"
          value={prefs.hideAmounts}
          onChange={(hideAmounts) => set({ hideAmounts })}
        />
      </Section>

      <Section label="Appearance">
        <Segmented<Prefs["appearance"]>
          label="Appearance"
          value={prefs.appearance}
          onChange={(appearance) => set({ appearance })}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Section>

      <Section label="Security">
        <Row
          icon={Lock}
          title="Lock with Face ID"
          trailing={
            <Switch
              value={prefs.biometricLock}
              onValueChange={(next) => void toggleLock(next)}
              trackColor={{ true: theme.color.accent, false: theme.color.secondary }}
              thumbColor={theme.color.card}
            />
          }
        />
        <Row
          icon={ShieldCheck}
          title="Recovery words"
          detail="Show them and check your backup"
          onPress={() => router.push("/backup")}
        />
      </Section>

      <Section label="Network">
        <Row
          icon={Globe}
          title={NETWORK_LABEL[network]}
          detail="Change network"
          onPress={() => router.push("/network")}
        />
      </Section>

      <Section label="Tickets">
        <Row
          icon={Upload}
          title="Export tickets"
          detail={`${NETWORK_LABEL[network]} · an encrypted file`}
          onPress={() => router.push("/transfer-file?mode=export")}
        />
        <Row
          icon={Download}
          title="Import tickets"
          detail="From the app or the website"
          onPress={() => router.push("/transfer-file?mode=import")}
        />
      </Section>

      <Section label="App">
        <Row
          icon={RefreshCw}
          title="Check for updates"
          detail="Only when you ask; nothing checks in the background"
          onPress={() => void checkUpdates()}
        />
        {update ? <Strip>{update}</Strip> : null}
        <Row
          icon={KeyRound}
          title="Operator key"
          detail={
            key
              ? `${NETWORK_LABEL[network]}: ${key.slice(0, FINGERPRINT)}…${key.slice(-FINGERPRINT / 2)}`
              : `No ${NETWORK_LABEL[network]} key in this build`
          }
        />
      </Section>

      <Row
        icon={Trash2}
        title="Forget this device"
        detail="Delete wallets, tickets and settings here"
        onPress={forget}
      />
      <View style={{ alignItems: "center" }}>
        <Txt variant="meta" tone="text3">
          Kakure {Application.nativeApplicationVersion ?? "dev"} ({Application.nativeBuildVersion ?? "dev"})
        </Txt>
      </View>
    </Screen>
  );
}
