import { zatToZec } from "@kakure/domain";
import type { TicketStatus } from "@kakure/query";
import type { ComponentRef, Ref } from "react";
import { StyleSheet, View } from "react-native";
import { HASH_SHORT, NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { Mark } from "@/kit/mark";
import { QrSvg } from "@/kit/qr-svg";
import { Txt } from "@/kit/text";
import { formatDateTime } from "@/lib/time";
import { assetFor } from "@/markets/assets";
import { MARKS } from "@/markets/generated/marks";
import { SIDE_SIGN, sideWord } from "@/markets/market-view";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemed } from "@/theme/theme-provider";
import type { AppTicket } from "@/tickets/ticket-db";
import { folioOf } from "./folio";

/**
 * Kawase's perforated slip (kawase.md §6.1), for a Kakure ticket: the head with the folio, the result and figure,
 * the seal, the facts, a perforation with notches cut in the ground colour, and a stub with the verify link's QR.
 * Redacted by default (plan §3): no payout address, no txid, no bet time.
 */
export interface SlipModel {
  ticket: AppTicket;
  status: TicketStatus;
  payoutZat: bigint | null;
  seq: number | null;
  verifyUrl: string;
  mode: "provable" | "outcome";
}

const RESULT: Record<TicketStatus, string> = {
  waiting: "Ticket built",
  counted: "Ticket counted",
  won: "You won",
  paid: "You won · paid",
  lost: "Not this time",
  refunded: "Refunded",
  missed: "Not counted",
  unknown: "Ticket",
};

const SEAL_SIZE = 74;
const SEAL_TILT = "-10deg";
const NOTCH = 16;
const STUB_QR = 92;
const SLIP_MAX = 380;
/** The paper stays light in both themes, so labels are paper ink at reduced opacity (≥ 4.5:1 on white). */
const LABEL_OPACITY = 0.66;

function styles(theme: Theme) {
  return StyleSheet.create({
    slip: {
      width: "100%",
      maxWidth: SLIP_MAX,
      alignSelf: "center",
      backgroundColor: theme.color.paper,
      borderRadius: theme.radius.receipt,
      overflow: "hidden",
    },
    body: { padding: theme.space.lgPlus, gap: theme.space.md },
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    brand: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    result: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    seal: {
      width: SEAL_SIZE,
      height: SEAL_SIZE,
      borderRadius: SEAL_SIZE / 2,
      borderWidth: 3,
      alignItems: "center",
      justifyContent: "center",
      transform: [{ rotate: SEAL_TILT }],
    },
    rule: { height: 1, backgroundColor: theme.color.rowPressed },
    fact: { flexDirection: "row", justifyContent: "space-between", gap: theme.space.md },
    perforation: { flexDirection: "row", alignItems: "center", height: NOTCH },
    notch: { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2 },
    dashes: { flex: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: theme.color.border },
    stub: { flexDirection: "row", alignItems: "center", gap: theme.space.lg, padding: theme.space.lgPlus },
  });
}

function Fact({ label, value }: { label: string; value: string }) {
  const s = useThemed(styles);
  return (
    <View style={s.fact}>
      <Txt variant="meta" tone="paperInk" style={{ opacity: LABEL_OPACITY }}>
        {label}
      </Txt>
      <Txt variant="rowStrong" tone="paperInk" align="right" style={{ flexShrink: 1 }}>
        {value}
      </Txt>
    </View>
  );
}

export function ReceiptSlip({
  model,
  exporting = false,
  ref,
}: {
  model: SlipModel;
  exporting?: boolean;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  const theme = useTheme();
  const s = useThemed(styles);
  const { ticket, status, payoutZat, seq } = model;
  const coin = NETWORK_COIN[ticket.network];
  const asset = assetFor({ kind: ticket.kind, subject: ticket.subject });
  const figure =
    (status === "won" || status === "paid") && payoutZat !== null
      ? payoutZat
      : status === "refunded"
        ? BigInt(ticket.sizeZat)
        : BigInt(ticket.sizeZat);
  const sealColor =
    status === "won" || status === "paid"
      ? theme.color.success
      : status === "lost"
        ? theme.color.mutedForeground
        : theme.color.destructive;

  return (
    <View ref={ref} collapsable={false} style={[s.slip, !exporting && { boxShadow: theme.shadow.receipt.boxShadow }]}>
      <View style={s.body}>
        <View style={s.head}>
          <View style={s.brand}>
            <Mark svg={MARKS.zec} symbol="ZEC" size={theme.size.markCell} />
            <Txt variant="rowStrong" tone="paperInk">
              Kakure
            </Txt>
          </View>
          <Txt variant="label" tone="paperInk">
            TICKET #{folioOf(ticket)}
          </Txt>
        </View>
        <View style={s.result}>
          <View style={{ gap: theme.space.xs, flex: 1 }}>
            <Txt variant="label" tone="paperInk">
              {RESULT[status]}
            </Txt>
            <Txt variant="displayPrice" tone="paperInk">
              {zatToZec(figure)} {coin}
            </Txt>
            <Txt variant="rowDetail" tone="paperInk">
              {SIDE_SIGN[ticket.side]} {sideWord(ticket.side)} · {asset.symbol}
            </Txt>
          </View>
          <View style={[s.seal, { borderColor: sealColor }]} accessibilityLabel="Kakure seal">
            <Txt variant="title" style={{ color: sealColor }}>
              隠
            </Txt>
          </View>
        </View>
        <View style={s.rule} />
        <Fact label="Market" value={ticket.question} />
        <Fact label="Ticket" value={`${zatToZec(BigInt(ticket.sizeZat))} ${coin}`} />
        <Fact
          label="Network"
          value={`${NETWORK_LABEL[ticket.network]}${ticket.network === "testnet" ? " · test money" : ""}`}
        />
        <Fact label="Closes" value={formatDateTime(ticket.closesAt)} />
        {seq !== null ? <Fact label="Signed batch" value={String(seq)} /> : null}
        {/* The hash names the leaf in the signed list (and so the batch it arrived in): Provable only (audit O3). */}
        {model.mode === "provable" ? (
          <>
            <Fact
              label="Ticket hash"
              value={`${ticket.hash.slice(0, HASH_SHORT.head)}…${ticket.hash.slice(-HASH_SHORT.tail)}`}
            />
            <Fact label="Mode" value="Provable (shows the nonce)" />
          </>
        ) : null}
      </View>
      <View style={s.perforation}>
        <View
          style={[
            s.notch,
            { backgroundColor: exporting ? theme.color.paper : theme.color.background, marginLeft: -NOTCH / 2 },
          ]}
        />
        <View style={s.dashes} />
        <View
          style={[
            s.notch,
            { backgroundColor: exporting ? theme.color.paper : theme.color.background, marginRight: -NOTCH / 2 },
          ]}
        />
      </View>
      <View style={s.stub}>
        <View style={{ flex: 1, gap: theme.space.xs }}>
          <Txt variant="rowStrong" tone="paperInk">
            Verify it
          </Txt>
          <Txt variant="meta" tone="paperInk">
            {model.mode === "provable"
              ? exporting
                ? "Scan to check this ticket against the signed batch on getkakure.xyz/verify."
                : "Open the verify page: it finds this ticket in the signed list and checks the operator's signature."
              : exporting
                ? "Scan to check the outcome against the signed batch on getkakure.xyz/verify."
                : "Open the verify page: it checks the market's signed outcome and the operator's signature."}
          </Txt>
        </View>
        <QrSvg value={model.verifyUrl} size={STUB_QR} ecc="M" />
      </View>
    </View>
  );
}
