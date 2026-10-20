import type { InstallHint } from "./browser";

/**
 * The install flow's words (Mitoshi `features/install/copy.ts`, Owarine's `InstallSheet`; plan §00 "Mobile. Paused").
 * Every line is about what exists now: the web app installs from the browser today; the Android app was built for the
 * pool markets and is paused, so it is never offered here; there is no iPhone app. On an iPhone a Home Screen app keeps
 * its own storage, apart from Safari's (WebKit bug 181849, comment 3: "Home Screen apps are created as isolated
 * entities without shared state with the browser"), so chips held in Safari don't follow: the words say so wherever
 * Safari's steps appear, and point at the backup that carries them across.
 */
export const INSTALL = {
  cta: {
    prompt: "Install Kakure",
    installing: "Opening the install sheet…",
    installed: "Installed · open it from your home screen",
    ios: "Add to Home Screen",
  },
  iosSteps: ["Open this page in Safari", "Tap Share, the square with the arrow", "Tap Add to Home Screen, then Add"],
  iosStorage:
    "The Home Screen app keeps its own storage, apart from Safari's. Install it before you deposit, or bring chips across with a backup from Settings.",
  /** Where a browser without an install prompt keeps it: its name, then the menu path, item by item. */
  where: {
    android: { in: "In your browser", path: [{ item: "Menu" }, { item: "Add to Home screen" }] },
    chrome: {
      in: "In Chrome",
      path: [{ item: "⋮", label: "Chrome menu" }, { item: "Cast, save, and share" }, { item: "Install page as app" }],
    },
    edge: {
      in: "In Edge",
      path: [{ item: "…", label: "Edge menu" }, { item: "Apps" }, { item: "Install this site as an app" }],
    },
    safari: { in: "In Safari", path: [{ item: "File" }, { item: "Add to Dock" }] },
  },
  elsewhere: "Install from Chrome, Edge or Safari, or scan the code with your phone.",
  sheet: {
    title: "Install app",
    name: "Install Kakure",
    line: "Full screen, one tap from your home screen.",
    more: "iPhone and Android",
    moreNote: "on Get the app",
  },
} as const;

export type InstallWhere = keyof typeof INSTALL.where;

export function installWhere(hint: InstallHint): (typeof INSTALL.where)[InstallWhere] | null {
  return hint === "ios" || hint === "other" ? null : INSTALL.where[hint];
}

/** `/download`: one page for every way in, the one that works first. */
export const DOWNLOAD = {
  title: "Get the app",
  description: "Kakure on your phone: the web app installs from your browser, with no store and no account.",
  heading: { lead: "Kakure, ", em: "on your phone." },
  line: "The web app is the app. It installs from your browser: no store, no account, and your chips stay on the device.",
  heroScan: "Scan with your phone",
  web: {
    name: "Web app",
    chip: "Live",
    line: "Installs from your browser. No store.",
    scan: "Scan to install it on your phone",
  },
  android: {
    name: "Android",
    chip: "Paused",
    line: "The Android app was built for the earlier pool markets and is paused while the live ones roll out. Install the web app today.",
  },
  ios: { name: "iPhone", chip: "Not yet", line: "No iPhone app yet. Add the web app to your Home Screen from Safari." },
  qrLabel: (what: string) => `QR code: ${what}`,
} as const;
