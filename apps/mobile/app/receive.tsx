import * as Zingo from "@zingo";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { WalletMinimal } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { Button } from "@/kit/button";
import { DottedQr } from "@/kit/dotted-qr";
import { SheetBody } from "@/kit/screen";
import { EmptyState, Skeleton, Strip } from "@/kit/states";
import { Txt } from "@/kit/text";
import { useNetwork } from "@/network/network-store";
import { useTheme } from "@/theme/theme-provider";
import { useWallet } from "@/wallet/wallet-store";

/**
 * Receive (C10; kawase.md §8.2): a fresh Orchard-only address each time, as a dotted QR on the paper plate so it
 * scans in both themes, with Copy and Share. The code always encodes this wallet's live address, never a fixture.
 */
const QR_SIZE = 260;
const SHORT = 12;

export default function Receive() {
  const theme = useTheme();
  const wallet = useWallet();
  const network = useNetwork();
  const [address, setAddress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (wallet.phase !== "ready") return;
    Zingo.newPayoutAddress()
      .then((fresh) => setAddress(fresh.address))
      .catch((error: Error) => setProblem(error.message));
  }, [wallet.phase]);

  if (wallet.phase !== "ready") {
    return (
      <EmptyState
        icon={WalletMinimal}
        title="No wallet open"
        reason="Create or restore a wallet first."
        action={{ label: "Close", onPress: () => router.back() }}
      />
    );
  }
  return (
    <SheetBody
      title={`Receive ${NETWORK_COIN[network]}`}
      subtitle={`${NETWORK_LABEL[network]} · a fresh address for this payment`}
    >
      <View style={{ alignItems: "center", gap: theme.space.md }}>
        {address ? (
          <DottedQr value={address} size={QR_SIZE} ecc="M" label="Your receive address" />
        ) : (
          <Skeleton style={{ width: QR_SIZE, height: QR_SIZE, borderRadius: theme.radius.group }} />
        )}
        {address ? (
          <Txt variant="rowDetail" tone="muted" align="center" selectable>
            {`${address.slice(0, SHORT)}…${address.slice(-SHORT)}`}
          </Txt>
        ) : null}
      </View>
      {problem ? <Strip>{problem}</Strip> : null}
      {address ? (
        <View style={{ gap: theme.space.sm }}>
          <Button
            label={copied ? "Copied" : "Copy address"}
            onPress={() => {
              void Clipboard.setStringAsync(address);
              setCopied(true);
            }}
          />
          <Button label="Share" variant="secondary" size="md" onPress={() => void Share.share({ message: address })} />
        </View>
      ) : null}
      <Txt variant="meta" tone="text3">
        Orchard-only unified address: shielded funds arrive in Ironwood and can pay for bets once confirmed. Every
        address you get here belongs to this wallet; a new one each time keeps payers from linking your payments.
      </Txt>
    </SheetBody>
  );
}
