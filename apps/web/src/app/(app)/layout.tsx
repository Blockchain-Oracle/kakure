import type { ReactNode } from "react";
import { AppShell } from "@/features/shell/app-shell";

/** The app: rail on desktop, dock on phones (kawase.md §5). The landing at `/` has its own header instead. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
