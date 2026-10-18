import { encodeReceipt } from "@kakure/query";
import { router, useLocalSearchParams } from "expo-router";
import { Mail, SearchX, Share2 } from "lucide-react-native";
import { type ComponentRef, useRef, useState } from "react";
import { PixelRatio, View } from "react-native";
import { stepsFor } from "@/bet/bet-progress";
import { SITE_ORIGIN } from "@/constants";
import { useMarkets } from "@/data/markets";
import { Button } from "@/kit/button";
import { Segmented } from "@/kit/controls";
import { SheetBody } from "@/kit/screen";
import { EmptyState, Strip } from "@/kit/states";
import { Plate } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { TxSteps } from "@/kit/tx-steps";
import { useNow } from "@/lib/time";
import { ReceiptSlip, type SlipModel } from "@/receipts/receipt-slip";
import { captureSlip, emailSlip, shareSlip } from "@/receipts/share-receipt";
import { useTheme } from "@/theme/theme-provider";
import { NEVER_PUBLISHED_COPY, viewAppTicket, WAITING_COPY } from "@/tickets/ticket-view";
import { useTickets } from "@/tickets/use-tickets";

/**
 * A ticket (C4, C8; surfaces.md Ticket detail): the stub, its state from the signed bundle, and its receipt.
 * "Outcome slip" (default) shows no nonce and no hash; "Provable" adds both so anyone can recompute the leaf. The verify link
 * keeps the receipt in the #fragment, which is never sent to a server.
 */
const HEADLINES: Record<string, string> = {
  won: "You won",
  paid: "You won · paid",
  lost: "Not this time",
  refunded: "Refunded",
  counted: "Ticket counted",
  waiting: "Waiting for its batch",
  missed: "Not counted",
  unknown: "Ticket",
};

export default function TicketScreen() {
  const theme = useTheme();
  const { hash } = useLocalSearchParams<{ hash: string }>();
  const data = useMarkets();
  const tickets = useTickets(data.network);
  const now = useNow();
  const slip = useRef<ComponentRef<typeof View>>(null);
  const [mode, setMode] = useState<"outcome" | "provable">("outcome");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"share" | "email" | null>(null);

  const ticket = Array.isArray(tickets) ? tickets.find((candidate) => candidate.hash === hash) : undefined;
  if (!ticket) {
    return Array.isArray(tickets) ? (
      <EmptyState
        icon={SearchX}
        title="Ticket not found"
        reason="It isn't on this phone for this network."
        action={{ label: "Close", onPress: () => router.back() }}
      />
    ) : null;
  }
  const bundle = data.status === "ready" ? data.bundle : null;
  const view = viewAppTicket(ticket, bundle, now);
  const verifyUrl = `${SITE_ORIGIN}/verify#${encodeReceipt(ticket, mode, view.seq ?? undefined)}`;
  const model: SlipModel = { ticket, status: view.status, payoutZat: view.payoutZat, seq: view.seq, verifyUrl, mode };
  const headline = HEADLINES[view.status] ?? "Ticket";
  const counted = ["counted", "won", "lost", "refunded", "paid"].includes(view.status);

  const capture = () => captureSlip(slip, PixelRatio.get());

  return (
    <SheetBody title={headline}>
      {ticket.source === "wallet" && !counted ? (
        <Plate>
          <TxSteps steps={stepsFor(ticket, counted)} />
        </Plate>
      ) : null}
      {view.status === "waiting" && (ticket.source === "qr" || ticket.send?.state === "sent") ? (
        <Strip>{WAITING_COPY}</Strip>
      ) : view.status === "missed" ? (
        <Strip>
          Not in the signed list: unpaid, mined after the cutoff, or the wrong amount. Late and wrong-amount payments
          are refunded by the rules, and so is a ticket paid in time that was still waiting for its batch when the
          market closed.
        </Strip>
      ) : view.neverPublished ? (
        <Strip>{NEVER_PUBLISHED_COPY}</Strip>
      ) : null}
      <ReceiptSlip model={model} ref={slip} />
      <Segmented
        label="Receipt mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "outcome", label: "Outcome slip" },
          { value: "provable", label: "Provable" },
        ]}
      />
      {mode === "provable" ? (
        <Txt variant="meta" tone="muted">
          Provable shows the ticket's nonce, so anyone can check this exact ticket was counted. Share it only with
          people you'd tell the bet to.
        </Txt>
      ) : null}
      {note ? <Strip>{note}</Strip> : null}
      <View style={{ gap: theme.space.sm }}>
        <Button
          label="Share image"
          icon={Share2}
          busy={busy === "share"}
          onPress={() => {
            setBusy("share");
            capture()
              .then(shareSlip)
              .catch((error: Error) => setNote(`The image couldn't be made: ${error.message}`))
              .finally(() => setBusy(null));
          }}
        />
        <Button
          label="Email it"
          icon={Mail}
          variant="secondary"
          size="md"
          busy={busy === "email"}
          onPress={() => {
            setBusy("email");
            capture()
              .then((uri) => emailSlip(model, headline, uri))
              .then((outcome) => {
                if (outcome === "unavailable") setNote("Mail isn't set up on this phone. Use Share image instead.");
              })
              .catch((error: Error) => setNote(`The email couldn't be made: ${error.message}`))
              .finally(() => setBusy(null));
          }}
        />
        {ticket.source === "qr" && !counted ? (
          <Button
            label="Show the payment code"
            variant="quiet"
            size="sm"
            onPress={() => router.replace({ pathname: "/pay-qr", params: { hash: ticket.hash } })}
          />
        ) : null}
      </View>
    </SheetBody>
  );
}
