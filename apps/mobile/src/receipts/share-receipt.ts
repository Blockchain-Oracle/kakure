import { zatToZec } from "@kakure/domain";
import { native } from "@kakure/tokens/native";
import * as MailComposer from "expo-mail-composer";
import * as Sharing from "expo-sharing";
import type { ComponentRef, RefObject } from "react";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { HASH_SHORT, NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { sideWord } from "@/markets/market-view";
import { folioOf } from "./folio";
import type { SlipModel } from "./receipt-slip";

/**
 * Receipts leave the phone only when the person shares them (C8, PD9): the slip as a PNG through the share sheet,
 * or "Email it": the device's own mail app with Kawase's HTML slip and the PNG attached. There is no email server
 * (R5), and the HTML loads nothing remote (mail clients would fetch it, and that request would say who opened it).
 */
const PNG_WIDTH = 1080;

export async function captureSlip(
  ref: RefObject<ComponentRef<typeof View> | null>,
  pixelRatio: number,
): Promise<string> {
  if (!ref.current) throw new Error("The receipt isn't on screen yet.");
  const uri = await captureRef(ref, { format: "png", quality: 1, result: "tmpfile", width: PNG_WIDTH / pixelRatio });
  return uri.startsWith("file://") ? uri : `file://${uri}`;
}

export async function shareSlip(uri: string): Promise<void> {
  await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share receipt" });
}

const PAPER = native.themes.light.background;
const CARD = native.themes.light.paper;
const INK = native.themes.light.paperInk;
const TEXT2 = native.themes.light.mutedForeground;
const RULE = native.themes.light.rowPressed;
const LINK = native.themes.light.link;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The slip as table HTML with inline styles (kawase.md §7 Layout A), light on purpose, nothing remote. */
export function slipHtml(model: SlipModel, headline: string): string {
  const { ticket } = model;
  const coin = NETWORK_COIN[ticket.network];
  const figure =
    model.payoutZat !== null && (model.status === "won" || model.status === "paid")
      ? model.payoutZat
      : BigInt(ticket.sizeZat);
  const fact = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:${TEXT2};font-size:13px">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:14px;color:${INK}">${escapeHtml(value)}</td></tr>`;
  return `<!doctype html><html><head><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:24px;background:${PAPER};font-family:Inter,Helvetica,Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;margin:0 auto;background:${CARD};border-radius:20px">
<tr><td style="padding:22px 22px 8px 22px">
  <table role="presentation" width="100%"><tr>
    <td style="font-weight:700;font-size:16px">Kakure</td>
    <td style="text-align:right;font-size:12px;font-weight:600;letter-spacing:0.9px">TICKET #${escapeHtml(folioOf(ticket))}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:8px 22px">
  <div style="font-size:12px;font-weight:600">${escapeHtml(headline)}</div>
  <div style="font-family:'Roboto Condensed','Arial Narrow',Arial,sans-serif;font-weight:900;font-size:34px;line-height:40px">${escapeHtml(zatToZec(figure))} ${coin}</div>
  <div style="font-size:14px;color:${TEXT2}">${escapeHtml(sideWord(ticket.side))} · ${escapeHtml(ticket.subject.toUpperCase())}</div>
</td></tr>
<tr><td style="padding:8px 22px"><div style="height:1px;background:${RULE}"></div>
  <table role="presentation" width="100%">
    ${fact("Market", ticket.question)}
    ${fact("Ticket", `${zatToZec(BigInt(ticket.sizeZat))} ${coin}`)}
    ${fact("Network", NETWORK_LABEL[ticket.network])}
    ${model.seq !== null ? fact("Signed batch", String(model.seq)) : ""}
    ${model.mode === "provable" ? fact("Ticket hash", `${ticket.hash.slice(0, HASH_SHORT.head)}…${ticket.hash.slice(-HASH_SHORT.tail)}`) : ""}
  </table>
</td></tr>
<tr><td style="padding:0 22px"><div style="border-top:1px dashed ${RULE}"></div></td></tr>
<tr><td style="padding:16px 22px 22px 22px;font-size:13px">
  <div style="font-weight:600">Verify it</div>
  <div style="color:${TEXT2}">The picture attached carries a QR to the verify page. Or open:</div>
  <div style="word-break:break-all"><a href="${escapeHtml(model.verifyUrl)}" style="color:${LINK}">${escapeHtml(model.verifyUrl)}</a></div>
</td></tr>
</table>
<p style="text-align:center;font-size:12px;color:${TEXT2}">Sent from your own mail app. Kakure has no email server.</p>
</body></html>`;
}

export type EmailOutcome = "sent" | "saved" | "cancelled" | "unavailable";

export async function emailSlip(model: SlipModel, headline: string, pngUri: string): Promise<EmailOutcome> {
  if (!(await MailComposer.isAvailableAsync())) return "unavailable";
  const result = await MailComposer.composeAsync({
    subject: `Kakure ticket #${folioOf(model.ticket)}`,
    body: slipHtml(model, headline),
    isHtml: true,
    attachments: [pngUri],
  });
  return result.status === "sent" ? "sent" : result.status === "saved" ? "saved" : "cancelled";
}
