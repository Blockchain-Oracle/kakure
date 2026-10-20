import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import { Inter, Roboto_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import { Offline } from "@/components/offline";
import StaticSearchDialog from "@/components/search";
import "./global.css";

/** Inter and Roboto Condensed Black, self-hosted at build time like the app (no runtime font request). */
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--kakure-font-sans" });
const display = Roboto_Condensed({
  subsets: ["latin"],
  weight: "900",
  display: "swap",
  variable: "--kakure-font-display",
});

export const metadata: Metadata = {
  title: { default: "Kakure docs", template: "%s · Kakure docs" },
  description: "How Kakure works: your first trade, the privacy model, the rules, verifying, and the published files.",
  referrer: "no-referrer",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ SearchDialog: StaticSearchDialog }}>{children}</RootProvider>
        <Offline />
      </body>
    </html>
  );
}
