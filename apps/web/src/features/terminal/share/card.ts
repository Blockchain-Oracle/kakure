"use client";

import { encode } from "uqr";
import { CARD, CARD_LOSE, CARD_WIN, REVOKE_MS, ROI_TIERS, WEIGHT } from "./constants";

/**
 * A result as a PNG share card (Owarine `share-png.ts`; Kakure's cream stub): the call ("BTC UP · 1m"), the ROI (or an
 * arcade run's score), the date, the 隠 seal, the brand and the market link with its QR. Never a stake, a payout or anything that names the
 * position: one amount and a time would solve back to it. Drawn from the page's tokens and fonts; nothing leaves the
 * browser unless the person shares it.
 */
export interface ShareCard {
  call: string;
  /** A trade's return; or `score`, an arcade run's figure, drawn in ink. */
  roiPct?: number;
  score?: string;
  when: string;
  url: string;
  /** The line under the date ("Paid in private chips on Zcash" for a trade). */
  foot?: string;
}

const font = (weight: number, px: number, family: string) => `${weight} ${px}px ${family}`;
const HALF = 2;

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
  return {
    display: v("--font-display", "system-ui"),
    body: v("--font-sans", "system-ui"),
    mono: v("--font-mono", "monospace"),
    stamp: v("--font-stamp", "serif"),
    paper: v("--paper", "#F4EEE3"),
    ink: v("--paper-ink", "#141210"),
    rule: v("--paper-rule", "#D9CBB0"),
    accent: v("--vermilion", "#D93E1F"),
    win: CARD_WIN,
    lose: CARD_LOSE,
  };
}

function fit(ctx: CanvasRenderingContext2D, text: string, make: (px: number) => string, maxW: number, start: number) {
  let px = start;
  ctx.font = make(px);
  while (px > CARD.minFontPx && ctx.measureText(text).width > maxW) {
    px -= CARD.fontStep;
    ctx.font = make(px);
  }
}

function qr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fg: string, bg: string) {
  const { data } = encode(text, { ecc: "M", border: 0 });
  const n = data.length;
  const cell = size / (n + CARD.qrQuiet * HALF);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = fg;
  for (const [r, row] of data.entries()) {
    for (const [c, dark] of row.entries()) {
      if (dark)
        ctx.fillRect(x + (c + CARD.qrQuiet) * cell, y + (r + CARD.qrQuiet) * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }
}

export function roiText(roi: number): string {
  return `${roi >= 0 ? "+" : "−"}${Math.abs(roi).toFixed(1)}%`;
}

export async function renderShareCard(card: ShareCard): Promise<Blob> {
  await document.fonts.ready;
  const t = tokens();
  const canvas = document.createElement("canvas");
  canvas.width = CARD.w;
  canvas.height = CARD.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  // The stub: the paper plate with a perforation down its right third.
  ctx.fillStyle = t.ink;
  ctx.fillRect(0, 0, CARD.w, CARD.h);
  ctx.fillStyle = t.paper;
  ctx.beginPath();
  ctx.roundRect(CARD.inset, CARD.inset, CARD.w - CARD.inset * HALF, CARD.h - CARD.inset * HALF, CARD.radius);
  ctx.fill();
  const cut = CARD.w * CARD.leftShare;
  ctx.fillStyle = t.rule;
  for (let y = CARD.inset + CARD.perforationGap; y < CARD.h - CARD.inset; y += CARD.perforationGap) {
    ctx.beginPath();
    ctx.arc(cut, y, CARD.perforationRadius, 0, Math.PI * HALF);
    ctx.fill();
  }

  // The call and the result.
  const left = CARD.pad;
  const width = cut - CARD.pad * HALF;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = t.ink;
  fit(ctx, card.call.toUpperCase(), (px) => font(WEIGHT.bold, px, t.display), width, CARD.callPx);
  ctx.fillText(card.call.toUpperCase(), left, CARD.callY);
  const roi = card.roiPct ?? 0;
  ctx.fillStyle = card.score !== undefined ? t.ink : roi >= 0 ? t.win : t.lose;
  const result = card.score ?? roiText(roi);
  fit(ctx, result, (px) => font(WEIGHT.bold, px, t.mono), width, CARD.resultPx);
  ctx.fillText(result, left, CARD.resultY);
  ctx.fillStyle = t.ink;
  ctx.font = font(WEIGHT.semi, CARD.metaPx, t.body);
  ctx.fillText(card.when, left, CARD.metaY);
  ctx.fillText(card.foot ?? "Paid in private chips on Zcash", left, CARD.meta2Y);

  // The seal behind the result.
  ctx.save();
  ctx.globalAlpha = CARD.sealAlpha;
  ctx.fillStyle = t.accent;
  ctx.font = font(WEIGHT.black, CARD.sealPx, t.stamp);
  ctx.textAlign = "right";
  ctx.fillText("隠", cut - CARD.pad, CARD.h - CARD.pad);
  ctx.restore();

  // The brand and the way in.
  const right = cut + CARD.pad;
  ctx.textAlign = "left";
  ctx.fillStyle = t.ink;
  ctx.font = font(WEIGHT.bold, CARD.brandPx, t.display);
  ctx.fillText("KAKURE", right, CARD.brandY);
  ctx.font = font(WEIGHT.semi, CARD.taglinePx, t.body);
  ctx.fillText("Call the close.", right, CARD.taglineY);
  ctx.fillText("Nobody sees your trades.", right, CARD.tagline2Y);
  const short = card.url.replace(/^https?:\/\//, "");
  ctx.globalAlpha = CARD.urlAlpha;
  fit(ctx, short, (px) => font(WEIGHT.semi, px, t.body), CARD.w - right - CARD.pad, CARD.urlPx);
  ctx.fillText(short, right, CARD.urlY);
  ctx.globalAlpha = 1;
  qr(ctx, card.url, right, CARD.qrY, CARD.qrSize, t.ink, t.paper);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG render failed"))), "image/png"),
  );
}

/** The system share sheet where the browser can share files (phones), else a download. */
export async function saveCard(blob: Blob, filename: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch {
      // Cancelled or refused: a download instead.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
  return "downloaded";
}

/** The post's words by ROI tier (Owarine's), never an amount. */
export function postText(asset: string, side: string, roi: number): string {
  if (roi >= ROI_TIERS.moon) return `${roiText(roi)} ${side} on ${asset} on Kakure. Nobody saw it coming 🚀`;
  if (roi >= ROI_TIERS.great) return `${roiText(roi)} on ${asset}. Called the close, privately.`;
  if (roi >= 0) return `${roiText(roi)} on ${asset}. Up only, and nobody knows who.`;
  if (roi <= ROI_TIERS.rough) return `${roiText(roi)} on ${asset}. Rough one; on to the next.`;
  return `${roiText(roi)} on ${asset}. Taking the L, privately.`;
}
