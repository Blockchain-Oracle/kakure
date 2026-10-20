import type { Metadata } from "next";
import { TerminalScreen } from "@/features/terminal/terminal-screen";

/**
 * `/trade#BTC`: the rail's first place, the dock's seal and key 1; the live terminal for one asset (plan §00 T4). The
 * asset lives in the fragment, which the host never sees (PD19), so the terminal renders the page's one `<title>`
 * itself (React 19 hoists it) and the route renders none.
 */
export const metadata: Metadata = { title: null };

export default function TradePage() {
  return <TerminalScreen />;
}
