"use client";

import { Button, buttonClass, cx } from "@kakure/ui-web";
import { DottedQr } from "@kakure/ui-web/qr";
import { Copy, Eye, ShieldAlert, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { copySecret } from "@/lib/clipboard";

/**
 * A ZIP 321 payment request as a dotted code on a paper plate, with "Open in your wallet" and Copy. The request is a
 * bearer secret (its memo names a deposit only the payer and the operator should know, L26): it's built on this
 * device, never sent anywhere, and blurs whenever this window loses focus.
 */
const QR_SIZE = 248;
const COPIED_MS = 1800;

export function PayQr({ uri, caption, warning }: { uri: string; caption: ReactNode; warning: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const hide = () => setHidden(true);
    const onVisibility = () => document.hidden && hide();
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const copy = async () => {
    try {
      await copySecret(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        <div className="relative rounded-group bg-paper p-4">
          <div className={cx("transition-[filter] duration-(--duration-selection)", hidden && "blur-xl")}>
            <DottedQr value={uri} ecc="M" size={QR_SIZE} label="Payment code" />
          </div>
          {hidden ? (
            <button
              type="button"
              onClick={() => setHidden(false)}
              className="absolute inset-0 m-auto flex h-fit w-fit items-center gap-2 rounded-full bg-primary px-5 py-3 text-button-compact text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Eye aria-hidden className="size-4" /> Show code
            </button>
          ) : null}
        </div>
        <p className="text-center text-row-detail text-muted-foreground">{caption}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a href={uri} className={buttonClass("primary", "md", "w-full")}>
          <Wallet aria-hidden className="size-4" /> Open in wallet
        </a>
        <Button variant="secondary" className="w-full" onClick={() => void copy()}>
          <Copy aria-hidden className="size-4" /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="flex gap-2 rounded-row bg-warn-surface p-3 text-meta text-foreground">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
        <span>{warning}</span>
      </p>
    </div>
  );
}
