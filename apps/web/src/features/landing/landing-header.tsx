import { buttonClass } from "@kakure/ui-web";
import { Menu } from "lucide-react";
import Link from "next/link";
import { DOCS_ORIGIN } from "@/constants";
import { NetworkSwitch } from "@/features/network/network-switch";
import { Brand } from "@/features/shell/brand";
import { ThemeToggle } from "@/features/theme/theme-control";

/**
 * The landing header (refero-design-research §3.1): brand, Markets, How privacy works, Proof, Docs, Download and
 * the app; the network switch (the one glow) and the theme stay visible. No account button: bets come from your
 * own wallet. On phones the links fold into a <details> menu, so the menu needs no script.
 */
const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/privacy", label: "How privacy works" },
  { href: "/proof", label: "Proof" },
  { href: DOCS_ORIGIN, label: "Docs" },
  { href: "/download", label: "Download" },
];

const LINK =
  "rounded-full px-3 py-2 text-row-detail text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-(--layout-content-max) items-center gap-3 px-4 rail:px-8">
        <Link
          href="/"
          className="shrink-0 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Kakure home"
        >
          <Brand />
        </Link>
        <nav aria-label="Site" className="ml-4 hidden items-center gap-1 wide:flex">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={LINK}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden md:inline-flex">
            <NetworkSwitch />
          </span>
          <span className="inline-flex md:hidden">
            <NetworkSwitch labels={false} />
          </span>
          <ThemeToggle />
          <Link href="/markets" className={buttonClass("primary", "sm", "max-md:hidden")}>
            Open the app
          </Link>
          <details className="relative wide:hidden">
            <summary
              aria-label="Menu"
              className="grid size-11 cursor-pointer list-none place-items-center rounded-full text-muted-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </summary>
            <nav
              aria-label="Site"
              className="absolute right-0 mt-2 flex w-56 flex-col rounded-group bg-popover p-2 shadow-[inset_0_0_0_1px_var(--border)]"
            >
              {[...LINKS, { href: "/markets", label: "Open the app" }].map((link) => (
                <Link key={`${link.href}-${link.label}`} href={link.href} className={`${LINK} py-3`}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
