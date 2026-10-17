"use client";

/**
 * Registers public/sw.js in production builds (dev keeps the network honest for hot reload), and asks it to
 * prefetch both networks' public files on start and whenever the tab comes back (PD14 uniform requests).
 */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  const ask = () =>
    void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "prefetch" }));
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(ask)
    .catch(() => undefined);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ask();
  });
}
