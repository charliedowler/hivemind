import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerHiveTools } from "@/mcp/server";
import { withHiveBearerAuth } from "@/server/bearer-auth";
import { HiveError } from "@/server/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(registerHiveTools, { serverInfo: { name: "hive", version: "0.1.0" } });

async function route(request: Request): Promise<Response> {
  try {
    return await withHiveBearerAuth(request, async (req, ctx, claims) => withMcpAuth(handler, async () => ({
      token: req.headers.get("authorization")?.split(" ")[1] ?? "",
      clientId: typeof claims?.client_id === "string" ? claims.client_id : ctx.memberId,
      scopes: typeof claims?.scope === "string" ? claims.scope.split(" ") : ["hive"],
      ...(typeof claims?.exp === "number" ? { expiresAt: claims.exp } : {}),
      extra: ctx,
    }), { required: true })(req));
  } catch (error) {
    return Response.json({ error: error instanceof HiveError ? error.message : "The hive could not complete this request." }, { status: error instanceof HiveError ? error.status : 500 });
  }
}

export { route as GET, route as POST, route as DELETE };
