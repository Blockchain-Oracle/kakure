import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { APP_ORIGIN, REPO_URL } from "./constants";

/** Shared layout options: the brand, a link back to the app, the source repository. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-[family-name:var(--kakure-font-display)] text-lg font-black">
          <svg viewBox="0 0 28 28" aria-hidden className="size-6">
            <rect width="28" height="28" rx="8" fill="var(--primary)" />
            <circle cx="14" cy="15.5" r="6.5" fill="var(--accent)" />
            <rect x="5" y="15.5" width="18" height="8" fill="var(--primary)" />
            <rect x="6" y="15" width="16" height="1.6" rx="0.8" fill="var(--primary-foreground)" />
          </svg>
          Kakure docs
        </span>
      ),
    },
    links: [
      { text: "Open the app", url: APP_ORIGIN, external: true },
      { text: "Source", url: REPO_URL, external: true },
    ],
  };
}
