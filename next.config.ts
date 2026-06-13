import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  outputFileTracingRoot: process.cwd(),
  images: {
    remotePatterns: [
      // Add any external image domains here
    ],
  },
};

export default nextConfig;
