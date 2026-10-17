import { nextBatchAt } from "@kakure/query";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { EyeOff, SearchX } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { paymentUriFor } from "@/bet/external";
import { HASH_SHORT, NETWORK_COIN, SCREENSHOT_NOTE } from "@/constants";
import { useMarkets } from "@/data/markets";
import { fire } from "@/feedback/fire";
import { Button } from "@/kit/button";
import { DottedQr, type DottedQrHandle } from "@/kit/dotted-qr";
import { SheetBody } from "@/kit/screen";
import { EmptyState, Strip } from "@/kit/states";
import { Plate } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { formatClock } from "@/lib/time";
import { coinAmount, SIDE_SIGN, sideWord } from "@/markets/market-view";
import { useNetwork } from "@/network/network-store";
import { useTheme } from "@/theme/theme-provider";
import { useTickets } from "@/tickets/use-tickets";

/**
 * The QR sheet (C2/C3, L26): the ticket's ZIP 321 request as a dotted QR (error correction M, no centre mark) on the
 * paper plate. Screenshots are blocked, the code hides while the app is in the background, and switching networks
 * closes it (plan §13.16). The code is a bearer secret: whoever sees it learns the bet and its payout address.
 */
const QR_SIZE = 280;

export default function PayQr() {
  usePreventScreenCapture("pay-qr");
  const theme = useTheme();
  const { hash } = useLocalSearchParams<{ hash: string }>();
  const network = useNetwork();
  const data = useMarkets();
  const tickets = useTickets(network);
  const qr = useRef<DottedQrHandle>(null);
  const [opened] = useState(network);
  const [hidden, setHidden] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (network !== opened) router.back();
  }, [network, opened]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setHidden(state !== "active"));
    return () => sub.remove();
  }, []);

  const ticket = Array.isArray(tickets) ? tickets.find((candidate) => candidate.hash === hash) : undefined;
  const uri = ticket ? paymentUriFor(network, ticket.hash) : null;
  if (!ticket || !uri) {
    return Array.isArray(tickets) ? (
      <EmptyState
        icon={SearchX}
        title="Ticket not found"
        reason="This ticket isn't on this phone for this network."
        action={{ label: "Close", onPress: () => router.back() }}
      />
    ) : null;
  }
  const coin = NETWORK_COIN[network];
  const nextBatch = data.status === "ready" ? nextBatchAt(data.latest) : null;

  const save = async () => {
    const base64 = qr.current?.snapshot();
    if (!base64) return;
    const permission = await requestPermissionsAsync(true, ["photo"]);
    if (!permission.granted) {
      setNote("Photos access was refused, so nothing was saved. Allow adding photos in Settings to use this.");
      return;
    }
    const file = new File(Paths.cache, `kakure-pay-${ticket.hash.slice(0, HASH_SHORT.file)}.png`);
    file.create({ overwrite: true });
    file.write(base64, { encoding: "base64" });
    await Asset.create(file.uri);
    file.delete();
    fire("confirmed", { haptic: "filled" });
    setNote("Saved to Photos. Delete it after Zodl has scanned it: the picture is the bet and its payout address.");
  };

  return (
    <SheetBody
      title="Pay from your wallet"
      subtitle={`${SIDE_SIGN[ticket.side]} ${sideWord(ticket.side)} · ${coinAmount(BigInt(ticket.sizeZat), coin)}`}
    >
      <View style={{ alignItems: "center", gap: theme.space.md }}>
        {hidden ? (
          <View
            style={{
              width: QR_SIZE,
              height: QR_SIZE,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.color.secondary,
              borderRadius: theme.radius.group,
            }}
          >
            <EyeOff color={theme.color.mutedForeground} size={theme.size.icon} />
          </View>
        ) : (
          <DottedQr ref={qr} value={uri} size={QR_SIZE} ecc="M" label="Payment code for your wallet" />
        )}
        <Txt variant="rowStrong" align="center">
          Scan with Zodl or Zingo
        </Txt>
        <Txt variant="rowDetail" tone="muted" align="center">
          Send exactly {coinAmount(BigInt(ticket.sizeZat), coin)} with the memo it carries. Pay from Ironwood funds.
        </Txt>
      </View>
      <View style={{ gap: theme.space.sm }}>
        <Button
          label="Open in Zingo"
          onPress={() => void Linking.openURL(uri).catch(() => setNote("No wallet on this phone opens zcash: links."))}
        />
        <Button
          label="Copy payment link"
          variant="secondary"
          size="md"
          onPress={() => {
            void Clipboard.setStringAsync(uri, { android: { isSensitive: true } });
            setNote("Copied. Paste it into your wallet, then clear your clipboard.");
          }}
        />
        <Button label="Save QR image" variant="secondary" size="md" onPress={() => void save()} />
      </View>
      {note ? <Strip>{note}</Strip> : null}
      <Plate raised>
        <Txt variant="rowStrong">Keep this code to yourself</Txt>
        <Txt variant="rowDetail" tone="muted">
          Anyone who sees it learns your side, size and payout address. A saved image stays in Photos until you delete
          it. {SCREENSHOT_NOTE}
        </Txt>
      </Plate>
      <Txt variant="meta" tone="text3">
        Waiting for the chain.
        {nextBatch
          ? ` The next signed batch is at ${formatClock(nextBatch)}; your ticket shows Counted once it is in one.`
          : ""}
      </Txt>
    </SheetBody>
  );
}
