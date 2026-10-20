/**
 * The one navigation registry (Mitoshi's nav-items contract, mitoshi-code-study.md §1.2): the five places on the rail
 * (keys 1–5), the phone dock, and More's sections of one-word tiles. Every page in src/app must have a home here:
 * `scripts/reachability.mjs` reads this file directly (Node strips the types), so it imports nothing and holds
 * only data and pure functions. Icons are attached in `nav-icons.tsx`.
 */

export type PlaceId = "trade" | "markets" | "portfolio" | "games" | "leaderboard";
export type TileId = "verify" | "proof" | "privacy" | "docs" | "download" | "settings" | "status";
export type NavId = PlaceId | TileId;

export interface NavEntry {
  id: NavId;
  /** The rail and palette name. */
  name: string;
  /** More's one-word tile label. */
  tile: string;
  /** An app path, or `external: true` for the docs site (the app fills in the origin). */
  href: string;
  external?: boolean;
  /** One line: what you do there (tooltips, the palette). */
  description: string;
  /** Extra words the palette matches. */
  keywords?: string;
  /** Paths this entry is "here" on (prefix match); defaults to its own href. */
  paths?: readonly string[];
}

export const PLACES: readonly NavEntry[] = [
  {
    id: "trade",
    name: "Trade",
    tile: "Trade",
    href: "/trade",
    description: "Call the close on a live chart.",
    keywords: "terminal chart up down btc",
  },
  {
    id: "markets",
    name: "Markets",
    tile: "Markets",
    href: "/markets",
    description: "Every open window: crypto, stocks and Zcash.",
    keywords: "crypto stocks zcash zec btc eth sol hourly daily close",
    paths: ["/markets", "/m"],
  },
  {
    id: "portfolio",
    name: "Portfolio",
    tile: "Portfolio",
    href: "/portfolio",
    description: "Your tickets, kept on this device.",
    keywords: "tickets receipts positions payouts",
  },
  {
    id: "games",
    name: "Games",
    tile: "Games",
    href: "/games",
    description: "The games hall, opening in R4.",
    keywords: "practice line rider candle hop lucky duel range moonshot arcade",
  },
  {
    id: "leaderboard",
    name: "Leaderboard",
    tile: "Ranks",
    href: "/leaderboard",
    description: "Nickname boards, opening with the games.",
    keywords: "rank ranking board nickname",
  },
];

export interface NavSection {
  id: string;
  name: string;
  items: readonly NavEntry[];
}

export const MORE_SECTIONS: readonly NavSection[] = [
  {
    id: "trust",
    name: "Trust",
    items: [
      {
        id: "verify",
        name: "Verify",
        tile: "Verify",
        href: "/verify",
        description: "Check your positions against the signed record.",
        keywords: "receipt check certificate position provable outcome signature",
      },
      {
        id: "proof",
        name: "Proof",
        tile: "Proof",
        href: "/proof",
        description: "Every settlement, recomputed from signed prints.",
        keywords: "resolution settlement signed prints evidence sources",
      },
      {
        id: "privacy",
        name: "How privacy works",
        tile: "Privacy",
        href: "/privacy",
        description: "Who sees what, and why.",
        keywords: "shielded private who sees what",
      },
    ],
  },
  {
    id: "learn",
    name: "Learn",
    items: [
      {
        id: "docs",
        name: "Docs",
        tile: "Docs",
        href: "/",
        external: true,
        description: "Step-by-step guides.",
        keywords: "guides documentation help rules",
      },
      {
        id: "download",
        name: "Get the app",
        tile: "Download",
        href: "/download",
        description: "Install the web app on your phone.",
        keywords: "install app phone home screen android iphone pwa",
      },
    ],
  },
  {
    id: "device",
    name: "This device",
    items: [
      {
        id: "settings",
        name: "Settings",
        tile: "Settings",
        href: "/settings",
        description: "Theme, sound, motion and this device's data.",
        keywords: "theme sound motion forget export backup",
      },
      {
        id: "status",
        name: "Status",
        tile: "Status",
        href: "/status",
        description: "The price relay and the signed data, live.",
        keywords: "health relay connection batch",
      },
    ],
  },
];

export const MORE_ITEMS: readonly NavEntry[] = MORE_SECTIONS.flatMap((section) => section.items);

/** The phone dock: Markets · Portfolio · the seal (Trade) · Games · More (Mitoshi MobileDock). */
export const DOCK_PLACES: readonly PlaceId[] = ["markets", "portfolio", "games"];
/** The seal sits in the dock's middle slot. */
export const SEAL_SLOT = 2;

/** The landing is outside the shell; the rail's mark and the phone's mark link to it. */
export const LANDING_PATH = "/";

function pathsOf(entry: NavEntry): readonly string[] {
  return entry.external ? [] : (entry.paths ?? [entry.href]);
}

function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The rail place a path belongs to, or null (then More is "here"). */
export function placeOf(pathname: string | null): PlaceId | null {
  if (!pathname) return null;
  const place = PLACES.find((entry) => pathsOf(entry).some((path) => matches(pathname, path)));
  return place ? (place.id as PlaceId) : null;
}

/** Where a route lives in the navigation: a place, a More tile, the brand mark, or nowhere (null). */
export function homeOf(pathname: string): string | null {
  if (pathname === LANDING_PATH) return "brand mark";
  const place = PLACES.find((entry) => pathsOf(entry).some((path) => matches(pathname, path)));
  if (place) return `rail: ${place.name}`;
  const tile = MORE_ITEMS.find((entry) => pathsOf(entry).some((path) => matches(pathname, path)));
  return tile ? `More: ${tile.tile}` : null;
}

/** Detail pages whose parent is not their path's parent: a market (`/m#<network>/<id>`) sits under Markets. */
export const DETAIL_PARENTS: Readonly<Record<string, string>> = { "/m": "/markets" };

/** The top level: one segment or none, except a detail page. Below it, the top line shows a back chevron. */
export function isTopLevel(pathname: string | null): boolean {
  if (!pathname || pathname === LANDING_PATH) return true;
  if (pathname in DETAIL_PARENTS) return false;
  return pathname.split("/").filter(Boolean).length < 2;
}

/** The page above a nested route. */
export function parentOf(pathname: string): string {
  const detail = DETAIL_PARENTS[pathname];
  if (detail) return detail;
  const parts = pathname.split("/").filter(Boolean);
  return parts.length < 2 ? "/markets" : `/${parts.slice(0, -1).join("/")}`;
}
