"use client";

import { Dock, Rail } from "@kakure/ui-web";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { FAUCETS } from "@/constants";
import { useCategory } from "@/features/markets/category-store";
import { NetworkCapsule } from "@/features/network/network-capsule";
import { ThemeControl } from "@/features/theme/theme-control";
import { Brand } from "./brand";
import { AppLink, activeKeys, DOCK_ITEMS, RAIL_SECTIONS } from "./nav-items";
import { QuickToggles } from "./quick-toggles";

/**
 * Kawase's frame (kawase.md §5): from 768 px the window ground is the quiet plate, padded 16, with the floating rail
 * and the stage (radius 24) side by side; the rail is 248 wide from 1280 px and an 88 px icon rail below.
 * Below 768 px a top bar carries the brand, the network capsule and the theme, and the glass dock navigates.
 * Breakpoints are CSS, so the prerendered page is already the right shape.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const category = useCategory();
  const active = activeKeys(usePathname(), category);

  const header = (
    <div className="flex flex-col items-center gap-4 wide:items-stretch">
      <div className="px-1.5 wide:px-3">
        <span className="wide:hidden">
          <Brand wordmark={false} />
        </span>
        <span className="hidden wide:inline">
          <Brand />
        </span>
      </div>
      <div className="wide:px-1.5">
        <span className="wide:hidden">
          <NetworkCapsule compact />
        </span>
        <span className="hidden wide:inline">
          <NetworkCapsule />
        </span>
      </div>
    </div>
  );

  const footer = (
    <div className="flex flex-col items-center gap-2 wide:flex-row wide:justify-between wide:px-1.5">
      <span className="wide:hidden">
        <ThemeControl compact />
      </span>
      <span className="hidden wide:inline">
        <ThemeControl />
      </span>
      <QuickToggles />
    </div>
  );

  return (
    <div className="kk-frame min-h-dvh rail:flex rail:h-dvh rail:gap-4 rail:p-(--layout-window-inset)">
      <div className="hidden rail:block rail:h-full">
        <Rail sections={RAIL_SECTIONS} activeKey={active.rail} Link={AppLink} header={header} footer={footer} />
      </div>
      <div className="kk-stage flex min-h-dvh min-w-0 flex-1 flex-col rail:min-h-0 rail:overflow-hidden rail:rounded-stage">
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 rail:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            <NetworkCapsule />
            <ThemeControl compact />
          </div>
        </header>
        <TestnetStrip />
        <main id="main" className="flex-1 pb-28 rail:overflow-y-auto rail:pb-0">
          {children}
        </main>
      </div>
      <Dock items={DOCK_ITEMS} activeKey={active.dock} Link={AppLink} className="z-40 rail:hidden" />
    </div>
  );
}

/** Spans the stage on testnet (Kawase's testnet strip): the word, the coin's worth, and where to get TAZ. */
function TestnetStrip() {
  return (
    <div className="kk-when-testnet-block mx-5 mt-2 rounded-row bg-network-surface px-4 py-2.5 text-row-detail text-network-label rail:mx-0 rail:mt-0 rail:rounded-none rail:px-6">
      <span className="font-semibold">Testnet</span> · TAZ has no value. Get some from{" "}
      {FAUCETS.map((faucet, i) => (
        <span key={faucet.href}>
          {i > 0 ? " or " : null}
          <a
            href={faucet.href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold underline decoration-1 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {faucet.name}
          </a>
        </span>
      ))}
      .
    </div>
  );
}
