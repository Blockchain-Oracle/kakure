"use client";

import type { NavItem, NavLink } from "@kakure/ui-web";
import { Blocks, ChartLine, Coins } from "lucide-react";
import Link from "next/link";
import { type Category, isCategory, setCategory } from "@/features/markets/category-store";

/** Only routes that exist are listed; pages arrive with their stages (no placeholders, no "Soon"). */
export const NAV_ITEMS: ReadonlyArray<NavItem & { key: Category }> = [
  { key: "crypto", href: "/markets#crypto", label: "Crypto", icon: <Coins /> },
  { key: "stocks", href: "/markets#stocks", label: "Stocks", icon: <ChartLine /> },
  { key: "zcash", href: "/markets#zcash", label: "Zcash", icon: <Blocks /> },
];

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
