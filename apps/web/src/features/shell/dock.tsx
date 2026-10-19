"use client";

import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { BrandDisc } from "./brand";
import { NAV_ICONS } from "./nav-icons";
import { DOCK_PLACES, LANDING_PATH, PLACES, placeOf, SEAL_SLOT } from "./places";
import { setOverlay, useOverlay } from "./shell-store";

const TRADE = PLACES.find((place) => place.id === "trade");

/**
 * The phone dock below 768 px (Mitoshi MobileDock.tsx, app-shell.css:189-210, :318-323): a floating capsule on the
 * rail colour, radius 32 — Markets · Portfolio · the seal (Trade, a 48 px vermilion disc that glows on /trade) ·
 * Games · More, with one pill sliding to the lit slot by a transform. More is lit while it is open or on any page
 * that is no docked place.
 */
export function Dock() {
  const pathname = usePathname();
  const overlay = useOverlay();
  const place = placeOf(pathname);
  const docked = place ? DOCK_PLACES.indexOf(place) : -1;
  const trading = place === "trade";
  const moreOpen = overlay === "more";
  const moreLit = moreOpen || (docked < 0 && !trading && pathname !== LANDING_PATH);
  const active = moreLit ? -1 : docked;
  // The seal holds the middle slot, so places after it shift one slot right; More is the last slot.
  const slot = moreLit ? DOCK_PLACES.length + 1 : active >= SEAL_SLOT ? active + 1 : Math.max(active, 0);

  const items: ReactNode[] = DOCK_PLACES.map((id, i) => {
    const entry = PLACES.find((each) => each.id === id);
    if (!entry) return null;
    const Icon = NAV_ICONS[id];
    return (
      <li key={id}>
        <Link href={entry.href} aria-current={i === active ? "page" : undefined} className="kk-dock-item">
          <Icon aria-hidden className="kk-dock-icon" />
          <span>{entry.name}</span>
        </Link>
      </li>
    );
  });
  items.splice(
    SEAL_SLOT,
    0,
    <li key="seal">
      <Link
        href={TRADE?.href ?? "/trade"}
        aria-label="Trade"
        title="Trade"
        aria-current={trading && !moreOpen ? "page" : undefined}
        data-on={trading && !moreOpen ? "" : undefined}
        className="kk-dock-item kk-dock-seal"
      >
        <BrandDisc className="kk-dock-seal-disc" />
      </Link>
    </li>,
  );

  return (
    <nav aria-label="Places" className="kk-dock">
      <ul className="kk-dock-list">
        <li
          aria-hidden
          className="kk-dock-pill"
          data-on={active >= 0 || moreLit ? "" : undefined}
          style={{ "--dock-i": slot } as CSSProperties}
        />
        {items}
        <li>
          <button
            type="button"
            className="kk-dock-item"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            data-lit={moreLit ? "" : undefined}
            onClick={() => setOverlay("more")}
          >
            <LayoutGrid aria-hidden className="kk-dock-icon" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
