import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles output automatically - no need for standalone
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  images: {
    remotePatterns: [
      // Add any external image domains here
    ],
  },
};

export default nextConfig;
