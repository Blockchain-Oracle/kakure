"use client";

import { useTheme } from "next-themes";
import { use, useId, useSyncExternalStore } from "react";

/**
 * Renders a Mermaid diagram in the browser (the Fumadocs Mermaid guide's component). Mermaid loads only on pages
 * that have a diagram, and the drawing follows the light or dark theme.
 */
const noSubscription = () => () => undefined;

export function Mermaid({ chart }: { chart: string }) {
  const isClient = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (!isClient) return null;
  return <MermaidContent chart={chart} />;
}

const cache = new Map<string, Promise<unknown>>();

function cachePromise<T>(key: string, create: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached as Promise<T>;
  const promise = create();
  cache.set(key, promise);
  return promise;
}

function MermaidContent({ chart }: { chart: string }) {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const { default: mermaid } = use(cachePromise("mermaid", () => import("mermaid")));
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    fontFamily: "inherit",
    themeCSS: "margin: 1.5rem auto 0;",
    theme: resolvedTheme === "dark" ? "dark" : "neutral",
  });
  const { svg } = use(
    cachePromise(`${chart}-${resolvedTheme}`, () =>
      mermaid.render(id.replaceAll(":", ""), chart.replaceAll("\\n", "\n")),
    ),
  );
  // The SVG is Mermaid's own output from diagrams in this repository's docs (strict security level).
  return <div className="my-6 flex justify-center overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}
