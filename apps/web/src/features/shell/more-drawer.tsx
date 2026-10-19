"use client";

import { Sheet } from "@kakure/ui-web";
import { ArrowUpRight, Eye, EyeOff, Search, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_ORIGIN } from "@/constants";
import { setPrefs, usePrefs } from "@/features/settings/prefs-store";
import { ThemeToggle } from "@/features/theme/theme-control";
import { NAV_ICONS } from "./nav-icons";
import { DOCK_PLACES, MORE_SECTIONS, type NavEntry, PLACES } from "./places";
import { setOverlay, useOverlay } from "./shell-store";

/** The rail places the phone dock has no room for (Mitoshi DOCK_OMITTED): shown on phones only. */
const DOCKED: readonly string[] = DOCK_PLACES;
const UNDOCKED = PLACES.filter((place) => place.id !== "trade" && !DOCKED.includes(place.id));

function isHere(pathname: string | null, entry: NavEntry): boolean {
  if (!pathname || entry.external) return false;
  return (entry.paths ?? [entry.href]).some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** An app-library tile (Mitoshi EverythingDrawer `Tile`): a 44 px disc over one word; the current page in vermilion. */
function Tile({ entry, here }: { entry: NavEntry; here: boolean }) {
  const Icon = NAV_ICONS[entry.id];
  const body = (
    <>
      <span className="kk-tile-disc">
        <Icon aria-hidden />
      </span>
      <span className="kk-tile-name">
        {entry.tile}
        {entry.external ? <ArrowUpRight aria-hidden className="kk-tile-out" /> : null}
      </span>
    </>
  );
  const label = `${entry.name}. ${entry.description}`;
  if (entry.external) {
    return (
      <a
        href={DOCS_ORIGIN}
        target="_blank"
        rel="noopener noreferrer"
        className="kk-tile"
        aria-label={label}
        title={entry.description}
      >
        {body}
      </a>
    );
  }
  return (
    <Link
      href={entry.href}
      className="kk-tile"
      aria-label={label}
      title={entry.description}
      aria-current={here ? "page" : undefined}
      onClick={() => setOverlay(null)}
    >
      {body}
    </Link>
  );
}

/** The pinned foot (Mitoshi `MoreTools`): theme, sound and the privacy eye, 44 px each. */
function MoreTools() {
  const prefs = usePrefs();
  return (
    <div className="kk-more-tools">
      <ThemeToggle />
      <button
        type="button"
        className="kk-icon-button"
        aria-pressed={!prefs.sound}
        aria-label={prefs.sound ? "Mute sounds" : "Turn sounds on"}
        title={prefs.sound ? "Mute sounds" : "Turn sounds on"}
        onClick={() => setPrefs({ sound: !prefs.sound })}
      >
        {prefs.sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
      </button>
      <button
        type="button"
        className="kk-icon-button"
        aria-pressed={prefs.hideAmounts}
        aria-label={prefs.hideAmounts ? "Show amounts" : "Hide amounts"}
        title={prefs.hideAmounts ? "Show amounts" : "Hide amounts"}
        onClick={() => setPrefs({ hideAmounts: !prefs.hideAmounts })}
      >
        {prefs.hideAmounts ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </button>
    </div>
  );
}

/**
 * More (Mitoshi EverythingDrawer): a bottom sheet on phones, the wide right drawer from 768 px. The search pill opens
 * the ⌘K palette; on phones the undocked places come first as inverted tiles; then every page that is no place,
 * in sections of one-word tiles.
 */
export function MoreDrawer() {
  const overlay = useOverlay();
  const pathname = usePathname();
  return (
    <Sheet open={overlay === "more"} onClose={() => setOverlay(null)} title="More" size="wide" footer={<MoreTools />}>
      <div className="kk-more">
        <button type="button" className="kk-more-search" aria-haspopup="dialog" onClick={() => setOverlay("search")}>
          <Search aria-hidden />
          <span>Search markets and pages</span>
        </button>
        <nav className="kk-more-places" aria-label="More places">
          {UNDOCKED.map((place) => {
            const Icon = NAV_ICONS[place.id];
            return (
              <Link
                key={place.id}
                href={place.href}
                className="kk-more-place"
                aria-current={isHere(pathname, place) ? "page" : undefined}
                onClick={() => setOverlay(null)}
              >
                <Icon aria-hidden />
                <span>{place.name}</span>
              </Link>
            );
          })}
        </nav>
        {MORE_SECTIONS.map((section) => (
          <section key={section.id} className="kk-more-section" aria-labelledby={`more-${section.id}`}>
            <h3 id={`more-${section.id}`} className="kk-more-title">
              {section.name}
            </h3>
            <div className="kk-more-grid">
              {section.items.map((entry) => (
                <Tile key={entry.id} entry={entry} here={isHere(pathname, entry)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
