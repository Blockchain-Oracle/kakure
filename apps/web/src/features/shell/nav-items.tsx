"use client";

import type { NavItem, NavLink, RailSection } from "@kakure/ui-web";
import {
  BadgeCheck,
  Blocks,
  ChartLine,
  Coins,
  Download,
  FileCheck2,
  Settings,
  Shield,
  Store,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { type Category, isCategory, setCategory } from "@/features/markets/category-store";

/** Only routes that exist are listed; pages arrive with their stages (no placeholders, no "Soon"). */
export const CATEGORY_ITEMS: ReadonlyArray<NavItem & { key: Category }> = [
  { key: "crypto", href: "/markets#crypto", label: "Crypto", icon: <Coins /> },
  { key: "stocks", href: "/markets#stocks", label: "Stocks", icon: <ChartLine /> },
  { key: "zcash", href: "/markets#zcash", label: "Zcash", icon: <Blocks /> },
];

const PAGES = {
  portfolio: { key: "portfolio", href: "/portfolio", label: "Portfolio", icon: <Ticket /> },
  verify: { key: "verify", href: "/verify", label: "Verify", icon: <BadgeCheck /> },
  proof: { key: "proof", href: "/proof", label: "Proof", icon: <FileCheck2 /> },
  privacy: { key: "privacy", href: "/privacy", label: "How privacy works", icon: <Shield /> },
  download: { key: "download", href: "/download", label: "Get the app", icon: <Download /> },
  settings: { key: "settings", href: "/settings", label: "Settings", icon: <Settings /> },
} as const satisfies Record<string, NavItem>;

export const RAIL_SECTIONS: ReadonlyArray<RailSection> = [
  { key: "markets", label: "Markets", items: CATEGORY_ITEMS },
  { key: "you", label: "You", items: [PAGES.portfolio] },
  { key: "trust", label: "Trust", items: [PAGES.verify, PAGES.proof, PAGES.privacy] },
  { key: "app", label: "App", items: [PAGES.download, PAGES.settings] },
];

/** The phone dock: icon-only, four slots (Kawase §5). Proof, privacy and the download page are linked from Settings. */
export const DOCK_ITEMS: ReadonlyArray<NavItem> = [
  { key: "markets", href: "/markets", label: "Markets", icon: <Store /> },
  PAGES.portfolio,
  PAGES.verify,
  PAGES.settings,
];

export const ABOUT_LINKS = [PAGES.proof, PAGES.privacy, PAGES.download];

/** The active row for a path: market pages select their category tab, other pages themselves. */
export function activeKeys(pathname: string, category: Category): { rail: string; dock: string } {
  const page = Object.values(PAGES).find((item) => pathname.startsWith(item.href));
  if (page) return { rail: page.key, dock: page.key };
  return { rail: category, dock: "markets" };
}

/** next/link for the kit's rail and dock; a category link also selects its tab on the same page. */
export const AppLink: NavLink = ({ href, children, ...props }) => (
  <Link
    href={href}
    {...props}
    onClick={() => {
      const hash = href.split("#")[1] ?? "";
      if (isCategory(hash)) setCategory(hash, { writeHash: false });
    }}
  >
    {children}
  </Link>
);
