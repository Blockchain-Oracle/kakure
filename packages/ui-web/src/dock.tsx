"use client";

import { useRef } from "react";
import { cx } from "./cx";
import { linkProps, type NavItem, type NavLink } from "./nav";
import { useMeasuredPill } from "./use-pill";

/**
 * The phone dock. Adapted from 21st.dev arunachalam/bottom-nav-bar (#8343: a pill indicator on a spring, ARIA
 * navigation) toward Kawase's Dock (kawase.md §5): an icon-only glass capsule floating above the home indicator,
 * radius 40, slots 52, icon 24 (active stroke 2.4), a bubble that slides to the active slot on `dock-bubble`
 * (420/30 with overshoot). No text labels: assistive tech reads them. Glass falls back to the opaque plate under
 * Reduce Transparency (`.kk-glass`). The motion library is not used.
 */
export interface DockProps {
  items: ReadonlyArray<NavItem>;
  activeKey: string | null;
  Link: NavLink;
  className?: string;
}

export function Dock({ items, activeKey, Link, className }: DockProps) {
  const row = useRef<HTMLDivElement>(null);
  const bubble = useMeasuredPill(row, activeKey, "dock-bubble");

  return (
    <nav
      aria-label="Navigation"
      className={cx(
        "kk-glass fixed inset-x-0 mx-auto flex h-(--size-dock-height) w-fit items-center rounded-dock px-2",
        "bottom-[max(var(--layout-dock-min-bottom),calc(env(safe-area-inset-bottom)+var(--layout-dock-bottom-offset)))]",
        className,
      )}
    >
      <div ref={row} className="relative flex items-center gap-1">
        {bubble ? (
          <span
            aria-hidden
            className={cx("absolute top-0 left-0 rounded-full bg-card", bubble.className)}
            style={bubble.style}
          />
        ) : null}
        {items.map((item) => {
          const active = item.key === activeKey;
          const props = linkProps(
            item,
            active,
            cx(
              "kk-press relative grid size-(--size-dock-slot) place-items-center rounded-full outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active ? "text-foreground [&_svg]:stroke-[2.4]" : "text-muted-foreground",
              !bubble && active && "bg-card",
            ),
            true,
          );
          return (
            <Link key={item.key} {...props}>
              <span aria-hidden className="relative [&_svg]:size-6">
                {item.icon}
                {item.badge ? (
                  <span className="absolute -top-1.5 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-tab-label text-accent-foreground tabular-nums">
                    {item.badge}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
