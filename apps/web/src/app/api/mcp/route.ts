import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { registerHiveTools } from "@/mcp/server";
import { authenticateApiKey } from "@/server/auth";
import { HiveError } from "@/server/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(registerHiveTools, {
  serverInfo: { name: "hive", version: "0.1.0" },
});

async function verifyToken(
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const ctx = await authenticateApiKey(bearerToken);
  return ctx
    ? {
        token: bearerToken,
        clientId: ctx.memberId,
        scopes: ["hive"],
        extra: ctx,
      }
    : undefined;
}

const authenticatedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

async function route(req: Request): Promise<Response> {
  try {
    return await authenticatedHandler(req);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof HiveError
            ? error.message
            : "The hive could not complete this request.",
      },
      { status: error instanceof HiveError ? error.status : 500 },
    );
  }
}

export { route as GET, route as POST, route as DELETE };
