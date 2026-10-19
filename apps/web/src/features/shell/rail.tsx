"use client";

import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { DOCS_ORIGIN, REPO_URL } from "@/constants";
import { NetworkPlate, NetworkStamp } from "@/features/network/network-switch";
import { ThemeToggle } from "@/features/theme/theme-control";
import { BrandDisc, Wordmark } from "./brand";
import { NAV_ICONS } from "./nav-icons";
import { LANDING_PATH, PLACES, placeOf } from "./places";
import { setOverlay, useOverlay } from "./shell-store";

const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * The floating rail (Mitoshi Rail.tsx and app-shell.css:9-77): hidden on phones, an 88 px icon rail from 768 px and
 * 248 px from 1280 px, radius 32 on the rail colour (tinted on testnet). The head is the vermilion disc, the word and
 * the network plate with the glow switch; the places answer keys 1–5 and one pill slides to the active one by a CSS
 * transform; More is lit as "here" on any page that is no place; the foot holds the theme toggle and Docs · Legal.
 */
export function Rail() {
  const pathname = usePathname();
  const overlay = useOverlay();
  const active = PLACES.findIndex((place) => place.id === placeOf(pathname));
  const moreHere = active < 0 && pathname !== LANDING_PATH;

  return (
    <aside className="kk-rail" aria-label="Kakure">
      <div className="kk-rail-head">
        <Link href={LANDING_PATH} className="kk-rail-brand" aria-label="Kakure home" title="Kakure home">
          <BrandDisc />
          <Wordmark className="kk-rail-word" />
        </Link>
        <div className="kk-rail-plate">
          <NetworkPlate />
        </div>
        <div className="kk-rail-stamp">
          <NetworkStamp />
        </div>
      </div>

      <nav aria-label="Places" className="kk-rail-nav">
        <span
          aria-hidden
          className="kk-rail-pill"
          data-on={active >= 0 ? "" : undefined}
          style={{ "--rail-i": Math.max(active, 0) } as CSSProperties}
        />
        {PLACES.map((place, i) => {
          const Icon = NAV_ICONS[place.id];
          const on = i === active;
          return (
            <Link
              key={place.id}
              href={place.href}
              aria-current={on ? "page" : undefined}
              title={`${place.name}: ${place.description} (${i + 1})`}
              className="kk-rail-item"
            >
              <Icon aria-hidden className="kk-rail-icon" />
              <span className="kk-rail-label">{place.name}</span>
              <kbd aria-hidden className="kk-rail-key">
                {i + 1}
              </kbd>
            </Link>
          );
        })}
        <button
          type="button"
          className="kk-rail-item"
          aria-haspopup="dialog"
          aria-expanded={overlay === "more"}
          data-here={moreHere ? "" : undefined}
          title="More: every other page"
          onClick={() => setOverlay("more")}
        >
          <LayoutGrid aria-hidden className="kk-rail-icon" />
          <span className="kk-rail-label">More</span>
        </button>
      </nav>

      <div className="kk-rail-foot">
        <ThemeToggle />
        <nav className="kk-rail-legal" aria-label="About">
          <a href={DOCS_ORIGIN} target="_blank" rel="noopener noreferrer">
            Docs
          </a>
          <span aria-hidden>·</span>
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
            Legal
          </a>
        </nav>
      </div>
    </aside>
  );
}
