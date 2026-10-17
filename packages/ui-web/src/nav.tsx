import type { ReactElement, ReactNode } from "react";

/** Navigation items shared by the rail and the dock. The app supplies its router's link. */
export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
  /** A count shown on the accent badge (read aloud with the label). */
  badge?: number;
}

export interface NavLinkProps {
  href: string;
  className: string;
  children: ReactNode;
  "data-pill-key": string;
  "aria-current"?: "page";
  "aria-label"?: string;
  title?: string;
}

export type NavLink = (props: NavLinkProps) => ReactElement;

export function linkProps(item: NavItem, active: boolean, className: string, compactName: boolean): NavLinkProps {
  const name = item.badge ? `${item.label}, ${item.badge}` : item.label;
  return {
    href: item.href,
    className,
    children: null,
    "data-pill-key": item.key,
    ...(active ? { "aria-current": "page" as const } : {}),
    ...(compactName ? { "aria-label": name, title: item.label } : {}),
  };
}
