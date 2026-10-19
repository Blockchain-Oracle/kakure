"use client";

import { cx, SegmentedControl } from "@kakure/ui-web";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { setThemeMode, type ThemeMode, useIsDark, useThemeMode } from "./theme-store";

const OPTIONS = [
  { value: "dark", label: <Moon />, name: "Dark" },
  { value: "light", label: <Sun />, name: "Light" },
  { value: "system", label: <Monitor />, name: "System" },
] as const satisfies ReadonlyArray<{ value: ThemeMode; label: ReactNode; name: string }>;

/** Dark / light / system, for Settings. */
export function ThemeControl() {
  const mode = useThemeMode();
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

/**
 * The rail foot's and More's one-tap theme toggle (Mitoshi ThemeToggle: a 44 px circle on a hairline, the sun in
 * dark and the moon in cream). It sets an explicit choice; Settings can return to "system".
 */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useIsDark();
  const label = dark ? "Switch to light" : "Switch to dark";
  return (
    <button
      type="button"
      onClick={() => setThemeMode(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={cx("kk-icon-button kk-theme-toggle", className)}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </button>
  );
}
