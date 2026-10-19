import { tokens } from "@kakure/tokens";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { DataProvider } from "@/features/data/data-provider";
import { MarkSprite } from "@/features/markets/mark-sprite";
import { INIT_SCRIPT } from "@/features/shell/init-script";
import "./globals.css";

/**
 * Mitoshi's four faces (mitoshi-code-study.md §2.2): Sora for display, Inter for the interface, JetBrains Mono for
 * every figure, Noto Serif JP for 隠れ and the network stamps. next/font downloads the Google faces at build time and
 * serves them from this site; Noto Serif JP is a local subset of the four glyphs in use (src/fonts/noto-serif-jp,
 * OFL beside it), so no page requests a third party. Loader options must be literals.
 */
const display = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--kakure-font-display",
});
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--kakure-font-sans" });
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--kakure-font-mono",
});
const stamp = localFont({
  src: [
    { path: "../fonts/noto-serif-jp/500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/noto-serif-jp/700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--kakure-font-stamp",
});

export const metadata: Metadata = {
  title: { default: "Kakure · private prediction markets on Zcash", template: "%s · Kakure" },
  description:
    "Call the close on crypto, US stocks and Zcash itself with shielded ZEC. The odds are public; the bettors stay private.",
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: tokens.themes.light.canvas },
    { media: "(prefers-color-scheme: dark)", color: tokens.themes.dark.canvas },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-network={tokens.defaultNetwork}
      className={`${display.variable} ${sans.variable} ${mono.variable} ${stamp.variable} ${tokens.defaultMode} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* A fixed first-paint script with no user input (features/shell/init-script.ts). */}
        <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
      </head>
      <body>
        <MarkSprite />
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
