import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // E2E zaganja LASTNO `next dev`, da ne čaka na .next/dev/lock, ki ga lahko
  // drži tuji razvojni proces. `distDir` Next pozna samo v configu, ne kot env.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
