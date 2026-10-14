import { authHandler } from "@/server/auth-handler";

export const runtime = "nodejs";

// Only OAuth discovery lives here. Crawlers probe many other well-known files (security.txt, assetlinks.json,
// traffic-advice); answering those without starting the auth server keeps them off the database.
const discovery = /^\/\.well-known\/(?:oauth-protected-resource|oauth-authorization-server|openid-configuration)(?:\/|$)/;

function wellKnown(request: Request) {
  if (!discovery.test(new URL(request.url).pathname)) return new Response(null, { status: 404 });
  return authHandler(request);
}

export { wellKnown as GET, wellKnown as HEAD };
