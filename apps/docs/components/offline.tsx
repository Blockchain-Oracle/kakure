"use client";

import { useEffect } from "react";

/** Registers out/sw.js (written by scripts/offline.mjs) in production builds; dev keeps hot reload honest. */
export function Offline() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
