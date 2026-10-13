import { requireMcpAuth } from "@better-auth/mcp";
import type { HiveContext } from "@hivemind/core";
import type { JWTPayload } from "jose";
import { getAuth, mcpResource } from "./better-auth";
import { authenticateApiKey } from "./auth";
import { memberContext } from "./identity/enrollment";
import { personalMemberContext } from "./identity/enrollment";
import { credentialVersion, credentialEpoch, personScope, withCredentialScope } from "./identity/credential-scope";

export async function contextFromClaims(claims: JWTPayload): Promise<HiveContext | null> {
  if (typeof claims.hive_member_id !== "string" || typeof claims.hive_team_id !== "string" || claims.sub !== claims.hive_member_id) return null;
  if (claims.hive_credential_version !== credentialVersion || claims.hive_credential_epoch !== await credentialEpoch()) return null;
  if (claims.hive_access === "person") {
    if (typeof claims.scope !== "string" || !claims.scope.split(" ").includes(personScope)) return null;
    const personal = await personalMemberContext(claims.hive_member_id);
    return personal?.teamId === claims.hive_team_id ? personal : null;
  }
  if (claims.hive_access !== "team" || typeof claims.scope !== "string" || claims.scope.split(" ").includes(personScope)) return null;
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
    if (claims.hive_credential_version !== credentialVersion || claims.hive_credential_epoch !== await credentialEpoch()) return Response.json({ error: "Sign in to Hive again and allow access to your personal hive and organisations you join." }, { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } });
    const ctx = await contextFromClaims(claims);
    if (!ctx) return Response.json({ error: "This token has no active membership in its hive." }, { status: 403 });
    return withCredentialScope(ctx.memberId, claims.hive_access === "person", () => handler(req, ctx, claims));
  }, { resource, requiredScopes: ["hive"], challengeScopes: ["hive", personScope] })(request);
}
