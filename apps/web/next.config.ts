import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gohive.dev" }],
        destination: "https://gohive.dev/:path*",
        permanent: true,
      },
    ];
  },
  transpilePackages: ["@hivemind/core", "@hivemind/design-system"],
};

export default nextConfig;
