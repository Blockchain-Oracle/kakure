import { Menu } from "lucide-react";
import Link from "next/link";
import { DOCS_ORIGIN } from "@/constants";
import { Brand } from "@/features/shell/brand";
import { START, WORDS } from "./words";

/**
 * The floating glass nav (Mitoshi's landing nav): brand, the places, Download and the one vermilion action. On
 * phones the links fold into a `<details>` panel, so the menu ships no script.
 */
export function LandingNav() {
  const { nav } = WORDS;
  return (
    <header className="lp-nav-wrap">
      <nav className="lp-nav" aria-label={nav.label}>
        <Link href="/" aria-label={nav.home} className="rounded-full">
          <Brand />
        </Link>
        <div className="lp-nav-links">
          {nav.links.map((link) => (
            <Link key={link.href} href={link.href} className="lp-nav-link">
              {link.label}
            </Link>
          ))}
          <a href={DOCS_ORIGIN} className="lp-nav-link">
            {nav.docs}
          </a>
        </div>
        <div className="lp-nav-end">
          <Link href="/download" className="lp-nav-quiet">
            {nav.app}
          </Link>
          <Link href={START} className="lp-btn lp-btn--accent lp-btn--sm">
            {nav.start}
          </Link>
          <details className="lp-menu">
            <summary className="lp-menu-button" aria-label={nav.menu}>
              <Menu aria-hidden className="size-5" />
            </summary>
            <div className="lp-menu-panel">
              {nav.links.map((link) => (
                <Link key={link.href} href={link.href} className="lp-menu-link">
                  {link.label}
                </Link>
              ))}
              <a href={DOCS_ORIGIN} className="lp-menu-link">
                {nav.docs}
              </a>
              <Link href="/download" className="lp-menu-link">
                {nav.app}
              </Link>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
