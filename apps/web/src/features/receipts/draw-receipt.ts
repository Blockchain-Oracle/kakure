"use client";

import { tokens } from "@kakure/tokens";
import { encode } from "uqr";
import { RECEIPT_PNG } from "./constants";

/**
 * Draws the ticket stub as a PNG on a canvas, on this device only (C8): Kawase's slip (kawase.md §6.1) in its
 * `exporting` form, with no notches or shadow. It carries only what the chosen receipt mode allows; the payout
 * address, the bet time and any txid are never drawn.
 */
export interface ReceiptImage {
  folio: string;
  eyebrow: string;
  figure: string;
  caption: string;
  stamp?: string;
  facts: ReadonlyArray<[string, string]>;
  verifyUrl: string;
  footer: string;
}

const L = RECEIPT_PNG;
const HALF = 2;
const light = tokens.themes.light;
const COLORS = {
  paper: light.paper,
  ink: light["paper-ink"],
  text2: light["muted-foreground"],
  rule: light.border,
  accent: light.accent,
};

function fontFamily(variable: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

export async function drawReceipt(data: ReceiptImage): Promise<Blob> {
  await document.fonts.ready;
  const display = fontFamily("--font-display", "Arial Narrow");
  const sans = fontFamily("--font-sans", "system-ui");
  const qr = encode(data.verifyUrl, { ecc: "M", border: 0 });
  const factsHeight = data.facts.length * L.line;
  const height =
    L.pad * HALF +
    L.headGap +
    L.eyebrowGap +
    L.figure +
    L.figureGap +
    L.captionGap +
    factsHeight +
    L.factsGap +
    L.perforationGap +
    L.qr +
    L.footerGap;

  const canvas = document.createElement("canvas");
  canvas.width = L.width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, L.width, height);

  let y = L.pad;
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.ink;
  ctx.font = `900 ${L.title}px ${display}`;
  ctx.fillText("Kakure", L.pad, y);
  ctx.font = `600 ${L.meta}px ${sans}`;
  ctx.fillStyle = COLORS.text2;
  ctx.textAlign = "right";
  ctx.fillText(`Ticket ${data.folio}`, L.width - L.pad, y + L.folioOffset);
  ctx.textAlign = "left";
  y += L.headGap;

  ctx.font = `600 ${L.meta}px ${sans}`;
  ctx.fillText(data.eyebrow, L.pad, y);
  y += L.eyebrowGap;
  ctx.fillStyle = COLORS.ink;
  ctx.font = `900 ${L.figure}px ${display}`;
  ctx.fillText(data.figure, L.pad, y);
  if (data.stamp) {
    ctx.save();
    ctx.translate(L.width - L.pad - L.stampRadius, y + L.figure / HALF);
    ctx.rotate(L.stampTilt);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = L.stampStroke;
    ctx.beginPath();
    ctx.arc(0, 0, L.stampRadius, 0, Math.PI * HALF);
    ctx.stroke();
    ctx.fillStyle = COLORS.accent;
    ctx.font = `900 ${L.title}px ${display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(data.stamp, 0, 0);
    ctx.restore();
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
  }
  y += L.figure + L.figureGap;
  ctx.fillStyle = COLORS.text2;
  ctx.font = `400 ${L.body}px ${sans}`;
  ctx.fillText(data.caption, L.pad, y, L.width - L.pad * HALF);
  y += L.captionGap;

  for (const [label, value] of data.facts) {
    ctx.fillStyle = COLORS.text2;
    ctx.font = `400 ${L.meta}px ${sans}`;
    ctx.fillText(label, L.pad, y + L.factOffset);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 ${L.body}px ${sans}`;
    ctx.textAlign = "right";
    ctx.fillText(value, L.width - L.pad, y, L.width / HALF);
    ctx.textAlign = "left";
    y += L.line;
  }
  y += L.factsGap;
  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = L.perforationStroke;
  ctx.setLineDash([...L.perforationDash]);
  ctx.beginPath();
  ctx.moveTo(L.pad, y);
  ctx.lineTo(L.width - L.pad, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += L.perforationGap;

  const module = L.qr / qr.size;
  ctx.fillStyle = COLORS.ink;
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (!qr.data[row]?.[col]) continue;
      ctx.beginPath();
      ctx.arc(L.pad + (col + L.dot) * module, y + (row + L.dot) * module, module * L.dot, 0, Math.PI * HALF);
      ctx.fill();
    }
  }
  const x = L.pad + L.qr + L.stubTextX;
  const [verifyAt, line1, line2] = L.stubLines;
  ctx.font = `600 ${L.body}px ${sans}`;
  ctx.fillText("Verify it", x, y + verifyAt);
  ctx.fillStyle = COLORS.text2;
  ctx.font = `400 ${L.meta}px ${sans}`;
  ctx.fillText("Scan to check this ticket against", x, y + line1);
  ctx.fillText("the operator's signed batch.", x, y + line2);
  ctx.fillText(data.footer, x, y + L.qr - L.stubFooterOffset);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG failed"))), "image/png"),
  );
}
