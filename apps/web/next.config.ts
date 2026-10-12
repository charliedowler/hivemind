import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@hivemind/core", "@hivemind/design-system"],
};

export default nextConfig;
