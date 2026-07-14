import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @toastmasters/core ships raw TypeScript source (no build step) — Next must transpile it.
  transpilePackages: ["@toastmasters/core"],
  experimental: {
    esmExternals: true,
  },
};

export default nextConfig;
