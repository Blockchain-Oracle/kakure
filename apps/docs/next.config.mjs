import { createMDX } from "fumadocs-mdx/next";

/**
 * A static export served at the root of docs.getkakure.xyz (plan §13.11): no server, search included.
 * @type {import('next').NextConfig}
 */
const config = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  images: { unoptimized: true },
  transpilePackages: ["@kakure/domain", "@kakure/query", "@kakure/signing", "@kakure/tokens"],
};

const withMDX = createMDX();

export default withMDX(config);
