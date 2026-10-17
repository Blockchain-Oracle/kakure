"use client";

import { SegmentedControl } from "@kakure/ui-web";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { setThemeMode, type ThemeMode, useThemeMode } from "./theme-store";

const OPTIONS = [
  { value: "light", label: <Sun />, name: "Light" },
  { value: "dark", label: <Moon />, name: "Dark" },
  { value: "system", label: <Monitor />, name: "System" },
] as const satisfies ReadonlyArray<{ value: ThemeMode; label: ReactNode; name: string }>;

const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };
const ICON: Record<ThemeMode, ReactNode> = { light: <Sun />, dark: <Moon />, system: <Monitor /> };

/** Light / dark / system. A segmented control where it fits; one cycling button in the icon rail. */
export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const mode = useThemeMode();
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setThemeMode(NEXT[mode])}
        aria-label={`Theme: ${mode}. Switch to ${NEXT[mode]}`}
        className="kk-press grid size-11 place-items-center rounded-full bg-secondary text-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
      >
        {ICON[mode]}
      </button>
    );
  }
  return (
    <SegmentedControl
      label="Theme"
      size="sm"
      options={OPTIONS.map((option) => ({ ...option, label: <span className="[&_svg]:size-4">{option.label}</span> }))}
      value={mode}
      onChange={(next) => setThemeMode(next)}
    />
  );
}
