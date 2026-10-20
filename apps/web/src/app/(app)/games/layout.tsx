import type { ReactNode } from "react";
import { GamesShell } from "@/features/games/games-shell";
import { pixelFont } from "@/features/games/pixel-font";

/**
 * The one frame every mode shares (Mitoshi `app/(app)/games/layout.tsx`): the way back, whose money is at risk, sound,
 * haptics and motion, mounted once so a mode added later inherits them.
 */
export default function GamesLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${pixelFont.variable} contents`}>
      <GamesShell>{children}</GamesShell>
    </div>
  );
}
