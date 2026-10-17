"use client";

import { type ReactNode, useRef } from "react";
import { cx } from "./cx";
import { linkProps, type NavItem, type NavLink } from "./nav";
import { useMeasuredPill } from "./use-pill";

/**
 * The desktop sidebar. Adapted from 21st.dev wensity/sidebar (#31454: sections, badges, header/footer, an icon rail
 * when narrow) and unlumen/sidebar-001 (#21517, Kawase's Rail source: one active highlight measured to the row).
 * Kawase's Rail (kawase.md §5): a floating `card` plate, radius 24, padding 16 / 12, gap 16, the dock shadow;
 * 248 wide, 88 as an icon rail below 1280 px (by window width, in CSS, so nothing flashes on load);
 * rows 48 high, padding 12, radius 16, icon 20; one `raised-2` pill springs to the active row on `rail-pill`
 * (500/36). Section labels are `meta` in `text-3` and hide in the rail. Base UI, Tabler icons and the motion
 * library are not used.
 */
export interface RailSection {
  key: string;
  label?: string;
  items: ReadonlyArray<NavItem>;
}

export interface RailProps {
  sections: ReadonlyArray<RailSection>;
  activeKey: string | null;
  Link: NavLink;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Rail({ sections, activeKey, Link, header, footer, className }: RailProps) {
  const list = useRef<HTMLDivElement>(null);
  const pill = useMeasuredPill(list, activeKey, "rail-pill");

  return (
    <aside
      aria-label="Navigation"
      className={cx(
        "flex h-full w-(--layout-rail-compact) shrink-0 flex-col gap-4 rounded-stage bg-card px-3 py-4 shadow-dock wide:w-(--layout-rail-wide)",
        className,
      )}
    >
      {header ? <div className="shrink-0">{header}</div> : null}
      <div ref={list} className="relative min-h-0 flex-1 overflow-y-auto">
        {pill ? (
          <span
            aria-hidden
            className={cx("absolute top-0 left-0 rounded-row bg-raised-2", pill.className)}
            style={pill.style}
          />
        ) : null}
        <nav className="relative flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.key} className="flex flex-col gap-0.5">
              {section.label ? (
                <span className="hidden px-3 pb-1 text-meta text-text-3 wide:block">{section.label}</span>
              ) : null}
              {section.items.map((item) => {
                const active = item.key === activeKey;
                const props = linkProps(
                  item,
                  active,
                  cx(
                    "kk-press relative flex h-12 items-center justify-center gap-3 rounded-row px-3 outline-none wide:justify-start",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "text-row-strong text-foreground" : "text-row text-muted-foreground hover:bg-row-pressed",
                    !pill && active && "bg-raised-2",
                  ),
                  true,
                );
                return (
                  <Link key={item.key} {...props}>
                    <span aria-hidden className="[&_svg]:size-5">
                      {item.icon}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate wide:inline">{item.label}</span>
                    {item.badge ? (
                      <span
                        aria-hidden
                        className="absolute top-1 right-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1 text-tab-label text-accent-foreground tabular-nums wide:static"
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </aside>
  );
}
