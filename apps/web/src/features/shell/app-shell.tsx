import type { ReactNode } from "react";
import { Dock } from "./dock";
import { MoreDrawer } from "./more-drawer";
import { Rail } from "./rail";
import { TopLine } from "./top-line";

/**
 * The app shell (Mitoshi AppShell.tsx, mitoshi-code-study.md §1.2): the skip link, the floating rail, then a column
 * holding the top line and ONE bordered stage (radius 24, padding 16 / 24 / 32) that holds the page, then the phone
 * dock and the More drawer. The canvas around it is the world's: tinted vermilion on testnet. Breakpoints are CSS
 * (shell.css), so the prerendered page is already the right shape.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="kk-shell">
      <a className="kk-skip" href="#main">
        Skip to content
      </a>
      <Rail />
      <div className="kk-column">
        <TopLine />
        <main id="main" tabIndex={-1} className="kk-stage">
          {children}
        </main>
      </div>
      <Dock />
      <MoreDrawer />
    </div>
  );
}
