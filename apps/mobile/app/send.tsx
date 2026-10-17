import { zecToZat } from "@kakure/domain";
import * as Zingo from "@zingo";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { CircleCheck, ClipboardPaste, QrCode } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { NETWORK_COIN } from "@/constants";
import { fire } from "@/feedback/fire";
import { Button } from "@/kit/button";
import { SheetBody } from "@/kit/screen";
import { SlideToConfirm } from "@/kit/slide-to-confirm";
import { EmptyState, Strip } from "@/kit/states";
import { Fact, Plate } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { devLog } from "@/lib/dev-log";
import { coinAmount } from "@/markets/market-view";
import { useNetwork } from "@/network/network-store";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import { errorOf, refreshWallet, useWallet } from "@/wallet/wallet-store";

/**
 * Send (C10; kawase.md §8.1): who (paste or scan), how much, an optional memo, then slide to send. The CTA carries
 * the validation in words. It goes out over the Nym mixnet; the ending says what happened to the money.
 */
/** A shape check per network; the binding validates the address fully when it proposes the send. */
const ADDRESS_SHAPE = /^[0-9a-z]{30,}$/i;
const PREFIX = { testnet: /^(utest1|ztestsapling1|tm|textest1)/, mainnet: /^(u1|zs1|t1|t3|tex1)/ } as const;

function styles(theme: Theme) {
  return StyleSheet.create({
    field: {
      minHeight: theme.size.inputHeight,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.input,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.md,
      color: theme.color.foreground,
      ...theme.text.field,
    },
    pills: { flexDirection: "row", gap: theme.space.sm },
  });
}

export default function Send() {
  const theme = useTheme();
  const s = useThemed(styles);
  const params = useLocalSearchParams<{ to?: string; amount?: string; memo?: string }>();
  const wallet = useWallet();
  const network = useNetwork();
  const coin = NETWORK_COIN[network];
  const [to, setTo] = useState(params.to ?? "");
  const [amount, setAmount] = useState(params.amount ?? "");
  const [memo, setMemo] = useState(params.memo ?? "");
  const [state, setState] = useState<{ phase: "edit" | "sending" | "sent" | "failed"; detail?: string }>({
    phase: "edit",
  });

  if (wallet.phase !== "ready") {
    return (
      <EmptyState
        title="No wallet open"
        reason="Create or restore a wallet first."
        action={{ label: "Close", onPress: () => router.back() }}
      />
    );
  }
  let zat: bigint | null = null;
  try {
    zat = amount.trim() ? zecToZat(amount.trim()) : null;
  } catch {
    zat = null;
  }
  const spendable = wallet.pools?.spendable ?? 0n;
  const trimmed = to.trim();
  const addressOk = ADDRESS_SHAPE.test(trimmed) && PREFIX[network].test(trimmed);

  if (state.phase === "sent") {
    return (
      <EmptyState
        icon={CircleCheck}
        title="Sent privately"
        reason={`${coinAmount(zat ?? 0n, coin)} left your wallet over the Nym mixnet. It confirms in a block or two. ${state.detail ?? ""}`}
        action={{ label: "Done", onPress: () => router.back() }}
      />
    );
  }

  const send = async () => {
    if (zat === null) return;
    setState({ phase: "sending" });
    try {
      const result = await Zingo.send(to.trim(), zat, memo, { requestId: `send:${Date.now()}` });
      devLog(
        `send sent txid ${result.txids[0] ?? "?"} fee ${result.fee} from [${result.sourcePools.join(",")}] timings ${JSON.stringify(result.timings)}`,
      );
      fire("send", { identity: `send:${result.txids[0] ?? Date.now()}` });
      setState({ phase: "sent", detail: result.txids[0] ? `Transaction ${result.txids[0].slice(0, 10)}…` : "" });
      void refreshWallet();
    } catch (error) {
      const { code, message } = errorOf(error);
      devLog(`send failed: ${code}: ${message}`);
      fire("error");
      setState({ phase: "failed", detail: message });
    }
  };

  const cta = !addressOk
    ? "Enter a valid address"
    : zat === null || zat <= 0n
      ? "Enter an amount"
      : zat > spendable
        ? `You can send up to ${coinAmount(spendable, coin)}`
        : null;

  return (
    <SheetBody title={`Send ${coin}`}>
      <TextInput
        style={s.field}
        value={to}
        onChangeText={setTo}
        placeholder="Address"
        placeholderTextColor={theme.color.text3}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        accessibilityLabel="Recipient address"
      />
      <View style={s.pills}>
        <Button
          label="Paste"
          icon={ClipboardPaste}
          variant="secondary"
          size="sm"
          stretch={false}
          onPress={() => void Clipboard.getStringAsync().then((text) => setTo(text.trim()))}
        />
        <Button
          label="Scan"
          icon={QrCode}
          variant="secondary"
          size="sm"
          stretch={false}
          onPress={() => router.push("/scan?purpose=send")}
        />
      </View>
      <TextInput
        style={[s.field, theme.text.displayPrice]}
        value={amount}
        onChangeText={setAmount}
        placeholder={`0 ${coin}`}
        placeholderTextColor={theme.color.text3}
        keyboardType="decimal-pad"
        accessibilityLabel={`Amount in ${coin}`}
      />
      <TextInput
        style={s.field}
        value={memo}
        onChangeText={setMemo}
        placeholder="Memo (optional, shielded addresses only)"
        placeholderTextColor={theme.color.text3}
        maxLength={500}
        accessibilityLabel="Memo"
      />
      <Plate raised>
        <Fact label="Spendable" value={coinAmount(spendable, coin)} />
        <Fact label="Route" value="Nym mixnet" />
        <Txt variant="meta" tone="muted">
          The network fee (ZIP 317, usually 0.0001 {coin}) comes out of your balance.
        </Txt>
      </Plate>
      {state.phase === "failed" ? <Strip>{`Nothing left your wallet. ${state.detail ?? ""}`}</Strip> : null}
      {cta ? (
        <Button label={cta} onPress={() => undefined} />
      ) : (
        <SlideToConfirm
          label={`Slide to send ${coinAmount(zat ?? 0n, coin)}`}
          busy={state.phase === "sending"}
          onConfirm={() => void send()}
        />
      )}
    </SheetBody>
  );
}
