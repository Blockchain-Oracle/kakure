import { tokens } from "@kakure/tokens";
import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import { DataProvider } from "@/features/data/data-provider";
import { MarkSprite } from "@/features/markets/mark-sprite";
import { INIT_SCRIPT } from "@/features/shell/init-script";
import "./globals.css";

/**
 * Inter for the interface, Roboto Condensed Black (tokens.type.displayWeight, 900) for money and titles.
 * next/font downloads them at build time and serves them from this site: no runtime third-party request.
 * Font loader options must be literals, so the weight is written out here.
 */
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--kakure-font-sans" });
const display = Roboto_Condensed({
  subsets: ["latin"],
  weight: "900",
  display: "swap",
  variable: "--kakure-font-display",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: tokens.themes.light.background },
    { media: "(prefers-color-scheme: dark)", color: tokens.themes.dark.background },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-network={tokens.defaultNetwork}
      className={`${sans.variable} ${display.variable} antialiased`}
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
