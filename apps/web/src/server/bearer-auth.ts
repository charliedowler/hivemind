import { requireMcpAuth } from "@better-auth/mcp";
import type { HiveContext } from "@hivemind/core";
import type { JWTPayload } from "jose";
import { getAuth, mcpResource } from "./better-auth";
import { authenticateApiKey } from "./auth";
import { memberContext } from "./identity/enrollment";

export async function contextFromClaims(claims: JWTPayload): Promise<HiveContext | null> {
  if (typeof claims.hive_member_id !== "string" || typeof claims.hive_team_id !== "string" || claims.sub !== claims.hive_member_id) return null;
  return memberContext(claims.hive_member_id, claims.hive_team_id);
}

export async function withHiveBearerAuth(request: Request, handler: (request: Request, ctx: HiveContext, claims?: JWTPayload) => Promise<Response>) {
  const token = request.headers.get("authorization")?.match(/^Bearer (hm_[A-Za-z0-9_-]{43})$/i)?.[1];
  if (token) {
    const ctx = await authenticateApiKey(token);
    if (ctx) return handler(request, ctx);
  }
  const auth = await getAuth();
  const resource = mcpResource(auth);
  return requireMcpAuth(auth, async (req, claims) => {
    const ctx = await contextFromClaims(claims);
    if (!ctx) return Response.json({ error: "This token has no active membership in its hive." }, { status: 403 });
    return handler(req, ctx, claims);
  }, { resource, requiredScopes: ["hive"] })(request);
}
