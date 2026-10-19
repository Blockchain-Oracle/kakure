import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Mitoshi's button grammar (tokens.css:24-100): the one main action is the vermilion plate with on-accent ink, 48 high
 * with the 8 px corner (52 for a ticket's CTA, `lg`); secondary is a surface plate on a hairline; quiet is text on
 * hover fill. Hover lightens toward Mitoshi's accent-hover; a pressed fill takes the pressed ink. Press 100 ms in /
 * 160 ms out to 0.97. Disabled buttons are avoided: a blocked action names its fix instead.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "lg" | "md" | "sm";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed active:text-primary-pressed-foreground",
  secondary: "bg-secondary text-secondary-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-row-pressed",
  quiet: "bg-transparent text-foreground hover:bg-secondary",
};

const SIZE: Record<ButtonSize, string> = {
  lg: "h-(--size-cta-height) rounded-button px-6 text-button-label",
  md: "h-(--size-button-height) rounded-button px-5 text-button-label",
  sm: "h-(--size-button-compact-height) rounded-button-compact px-4 text-button-compact",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cx(
    "kk-press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-sans outline-none",
    "transition-colors duration-(--duration-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-stage",
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
