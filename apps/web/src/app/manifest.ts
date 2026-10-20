import { tokens } from "@kakure/tokens";
import type { MetadataRoute } from "next";

/**
 * The web app manifest (Mitoshi `web/src/app/manifest.ts`, Owarine's `manifest.webmanifest`): what makes "installs
 * from your browser" on /download true. Chrome and Edge offer Install, iOS adds it to the Home Screen with
 * `apple-icon.png`, and it opens straight into the terminal. Icons are `icon.svg` rendered at 192 and 512, and a
 * full-bleed 512 for the maskable shape (the mark sits inside the safe circle).
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  const ground = tokens.themes.dark.canvas;
  return {
    name: "Kakure — Trade every minute. Leave no trace.",
    short_name: "Kakure",
    description:
      "A private real-time prediction market on Zcash: call the price up or down with chips from a shielded deposit.",
    start_url: "/trade",
    scope: "/",
    display: "standalone",
    background_color: ground,
    theme_color: ground,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
