import type { CSSProperties, ReactNode } from "react";
import "./kit.css";

/**
 * A die-cut sticker (Mitoshi `components/kit/Sticker.tsx`, from Owarine): condensed caps on a bright tone with a cut
 * line, tilted a few degrees, for the claims the hall makes out loud: whose money is at risk on each cabinet.
 */
export type StickerTone = "accent" | "up" | "surface";

export function Sticker({
  tone = "accent",
  tilt = -3,
  title,
  className,
  children,
}: {
  tone?: StickerTone;
  tilt?: number;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      title={title}
      className={`gm-sticker${className ? ` ${className}` : ""}`}
      style={{ "--gm-tilt": `${tilt}deg` } as CSSProperties}
    >
      {children}
    </span>
  );
}
