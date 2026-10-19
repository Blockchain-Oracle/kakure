"use client";

import { ChevronLeft, Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NetworkChip, NetworkSwitch } from "@/features/network/network-switch";
import { BrandDisc } from "./brand";
import { HealthChip } from "./health-chip";
import { isTopLevel, LANDING_PATH, PLACES, parentOf } from "./places";
import { setOverlay, shortcutBlocked, useOverlay } from "./shell-store";

const loadPalette = () => import("./command-palette").then((module) => module.CommandPalette);
const CommandPalette = dynamic(loadPalette, { ssr: false });
const Shortcuts = dynamic(() => import("./shortcuts").then((module) => module.Shortcuts), { ssr: false });

/** Whether this tab has moved between the app's pages since it loaded: then Back has an in-app page to return to. */
let lastPath: string | null = null;
let movedInApp = false;

function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (lastPath !== null && lastPath !== pathname) movedInApp = true;
    lastPath = pathname;
  }, [pathname]);
  if (isTopLevel(pathname)) return null;
  return (
    <button
      type="button"
      className="kk-icon-button kk-topline-back"
      aria-label="Back"
      title="Back"
      onClick={() => (movedInApp ? router.back() : router.push(parentOf(pathname)))}
    >
      <ChevronLeft aria-hidden />
    </button>
  );
}

/** ⌘ K on Apple, Ctrl K elsewhere, decided on the client (the server renders ⌘ K). */
function SearchKeys() {
  const [apple, setApple] = useState(true);
  useEffect(() => setApple(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return (
    <span aria-hidden className="kk-topline-keys">
      <kbd className="kk-kbd">{apple ? "⌘" : "Ctrl"}</kbd>
      <kbd className="kk-kbd">K</kbd>
    </span>
  );
}

/** ⌘K or Ctrl K toggles search, `/` opens it, `?` lists the shortcuts, 1–5 jump between the places. */
function useShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOverlay("search");
        return;
      }
      if (shortcutBlocked(event)) return;
      if (event.key === "/") {
        event.preventDefault();
        setOverlay("search");
      } else if (event.key === "?") {
        event.preventDefault();
        setOverlay("keys");
      } else if (/^[1-9]$/.test(event.key)) {
        const place = PLACES[Number(event.key) - 1];
        if (!place) return;
        event.preventDefault();
        router.push(place.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}

/**
 * The line above the stage (Mitoshi TopLine.tsx, app-shell.css:88-120): the back chevron below the top level; on
 * phones the vermilion mark, the network chip and the switch (the rail is hidden there); from 768 px the health chip
 * and the search pill with its keys. The palette and the shortcuts are lazy islands; the palette's code loads on idle
 * so the first ⌘K opens at once.
 */
export function TopLine() {
  const overlay = useOverlay();
  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  useShortcuts();

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1));
    idle(() => void loadPalette());
  }, []);
  useEffect(() => {
    if (overlay === "search") setPalette(true);
    if (overlay === "keys") setKeys(true);
  }, [overlay]);

  return (
    <header className="kk-topline">
      <div className="kk-topline-lead">
        <BackButton />
        <Link href={LANDING_PATH} aria-label="Kakure home" title="Kakure home" className="kk-topline-mark">
          <BrandDisc />
        </Link>
        <span className="kk-phone-only">
          <NetworkChip />
        </span>
        <span className="kk-wide-only">
          <HealthChip />
        </span>
      </div>
      <div className="kk-topline-tools">
        <button
          type="button"
          className="kk-search-pill kk-wide-only"
          aria-label="Search markets and pages"
          aria-keyshortcuts="Meta+K Control+K /"
          onClick={() => setOverlay("search")}
        >
          <Search aria-hidden />
          <span className="kk-search-label">Search markets and pages</span>
          <SearchKeys />
        </button>
        <span className="kk-phone-only">
          <NetworkSwitch labels={false} />
        </span>
      </div>
      {palette ? <CommandPalette open={overlay === "search"} /> : null}
      {keys ? <Shortcuts open={overlay === "keys"} /> : null}
    </header>
  );
}
