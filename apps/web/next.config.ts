import type { NextConfig } from "next";
import { withConsentManifest } from "c15t/next/build";

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

export default withConsentManifest(nextConfig);
