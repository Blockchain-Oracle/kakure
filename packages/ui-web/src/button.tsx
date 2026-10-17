import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Kawase's button grammar (kawase.md §4.5, §4.8 "originui/button + Senryo"): the one main action is a black
 * plate with the `button` shadow, 56 high with corner 28; secondary is a quiet plate; compact is 44 / 22.
 * Press 100 ms in / 160 ms out to 0.97. Disabled buttons are avoided: a blocked action names its fix instead.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "lg" | "md" | "sm";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-button hover:bg-primary-pressed",
  secondary: "bg-secondary text-secondary-foreground hover:bg-row-pressed",
  quiet: "bg-transparent text-foreground hover:bg-row-pressed",
};

const SIZE: Record<ButtonSize, string> = {
  lg: "h-14 rounded-button px-6 text-button-label",
  md: "h-12 rounded-button px-5 text-button-label",
  sm: "h-11 rounded-button-compact px-4 text-button-compact",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cx(
    "kk-press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-sans outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
