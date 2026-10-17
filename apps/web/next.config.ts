import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { DEV_DATA_PORT } from "./src/dev-constants";

/** Workspace packages ship TypeScript source; Next compiles them with the app. */
const WORKSPACE_PACKAGES = [
  "@kakure/domain",
  "@kakure/feeds",
  "@kakure/query",
  "@kakure/signing",
  "@kakure/tokens",
  "@kakure/ui-web",
];

/**
 * A static export (plan §2, D10): no server, no route handlers, no rewrites in production.
 * In `next dev` only, `/data/*` is proxied to the tiny static server in scripts/dev.mjs, which serves the
 * operator's real signed files from services/operator/operator-data/<network>/public/.
 */
export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    devIndicators: false,
    transpilePackages: WORKSPACE_PACKAGES,
    images: { unoptimized: true },
    productionBrowserSourceMaps: process.env.KAKURE_SOURCE_MAPS === "1",
  };
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...base,
      async rewrites() {
        return [{ source: "/data/:path*", destination: `http://127.0.0.1:${DEV_DATA_PORT}/data/:path*` }];
      },
    };
  }
  return { ...base, output: "export" };
}
