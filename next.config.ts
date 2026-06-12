import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      // Add any external image domains here
    ],
  },
};

export default nextConfig;
