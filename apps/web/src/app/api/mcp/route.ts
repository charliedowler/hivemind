import { cliVersion } from "@/lib/cli-version";
import { apiKeyId, memberRole } from "@/server/analytics/events";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerHiveTools } from "@/mcp/server";
import { withHiveBearerAuth } from "@/server/bearer-auth";
import { trustedProxyIp } from "@/server/trusted-proxy";
import { HiveError } from "@/server/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

// Hive never publishes list changes, so it does not advertise them. Clients on the 2026-07-28 protocol otherwise
// hold a subscriptions/listen stream open until maxDuration and reconnect every minute, re-running credential checks.
const capabilities = { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } };

const handler = createMcpHandler(registerHiveTools, { serverInfo: { name: "hive", version: cliVersion.latest }, capabilities });

// Serving is stateless: there is no session to delete and no stream to resume, so GET and DELETE always end in 405.
// Answer them before resolving credentials so idle clients cost no database reads. Requests without credentials still
// get the OAuth challenge from withHiveBearerAuth.
function methodNotAllowed() {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405, headers: { Allow: "POST" } });
}

async function route(request: Request): Promise<Response> {
  if (request.method !== "POST" && request.headers.has("authorization")) return methodNotAllowed();
  try {
    return await withHiveBearerAuth(request, async (req, ctx, claims) => withMcpAuth(handler, async () => ({
      token: req.headers.get("authorization")?.split(" ")[1] ?? "",
      clientId: typeof claims?.client_id === "string" ? claims.client_id : ctx.memberId,
      scopes: typeof claims?.scope === "string" ? claims.scope.split(" ") : ["hive"],
      ...(typeof claims?.exp === "number" ? { expiresAt: claims.exp } : {}),
      extra: { ...ctx, trustedProxyIp: trustedProxyIp(req), apiKeyId: apiKeyId(ctx), role: memberRole(ctx), sessionKind: claims ? "oauth" : "api_key" },
    }), { required: true })(req));
  } catch (error) {
    return Response.json({ error: error instanceof HiveError ? error.message : "The hive could not complete this request." }, { status: error instanceof HiveError ? error.status : 500 });
  }
}

export { route as GET, route as POST, route as DELETE };
