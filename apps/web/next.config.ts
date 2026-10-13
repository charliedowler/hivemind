import type { NextConfig } from "next";
import { withConsentManifest } from "c15t/next/build";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      { source: "/app/conflicts", destination: "/app", permanent: true },
      { source: "/app/tree", destination: "/app/team#export", permanent: true },
      { source: "/app/admin/analytics", destination: "/app", permanent: true },
      { source: "/app/settings/slack/digests", destination: "/app/team#slack", permanent: true },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gohive.dev" }],
        destination: "https://gohive.dev/:path*",
        permanent: true,
      },
    ];
  },
  experimental: { authInterrupts: true },
  transpilePackages: ["@hivemind/core", "@hivemind/design-system"],
};

export default withConsentManifest(nextConfig);
