import type { NextConfig } from "next";
import { withConsentManifest } from "c15t/next/build";

// Redirect www.<host> to the canonical PUBLIC_URL origin, when one is set at build time.
const publicOrigin = URL.parse(process.env.PUBLIC_URL?.trim() ?? "");
const wwwRedirect =
  publicOrigin && /^https?:$/.test(publicOrigin.protocol) && !publicOrigin.hostname.startsWith("www.") && publicOrigin.hostname.includes(".")
    ? [{ source: "/:path*", has: [{ type: "host" as const, value: `www.${publicOrigin.host}` }], destination: `${publicOrigin.origin}/:path*`, permanent: true }]
    : [];

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      { source: "/app/conflicts", destination: "/app", permanent: true },
      { source: "/app/tree", destination: "/app/team#export", permanent: true },
      { source: "/app/admin/analytics", destination: "/app", permanent: true },
      { source: "/app/settings/slack/digests", destination: "/app/team#slack", permanent: true },
      ...wwwRedirect,
    ];
  },
  experimental: { authInterrupts: true },
  transpilePackages: ["@hivemind/core", "@hivemind/design-system"],
};

export default withConsentManifest(nextConfig);
