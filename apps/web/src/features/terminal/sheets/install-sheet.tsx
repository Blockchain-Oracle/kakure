"use client";

import { Sheet } from "@kakure/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { InstallCta } from "@/features/install/install-cta";
import { INSTALL } from "@/features/install/words";
import { BrandDisc } from "@/features/shell/brand";

/**
 * Install app (Owarine `ui/sheets/InstallSheet.tsx`, Tradash's words; Mitoshi's sheet lists the other ways in under
 * its button): the browser's own install sheet where it offers one, else this phone's steps or this browser's menu
 * path, and "Installed" once it is. The phone apps' state lives on /download.
 */
export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sheet } = INSTALL;
  return (
    <Sheet open={open} onClose={onClose} title={sheet.title}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <BrandDisc />
          <div>
            <p className="text-row-strong text-foreground">{sheet.name}</p>
            <p className="text-meta text-muted-foreground">{sheet.line}</p>
          </div>
        </div>
        <InstallCta primary fill />
        <Link
          href="/download"
          className="flex items-center justify-between gap-3 rounded-row bg-secondary px-4 py-3 text-row-detail text-foreground hover:bg-row-pressed"
        >
          <span>
            {sheet.more} <span className="text-muted-foreground">· {sheet.moreNote}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        </Link>
      </div>
    </Sheet>
  );
}
