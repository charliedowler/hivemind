import { requireMcpAuth } from "@better-auth/mcp";
import type { HiveContext } from "@hivemind/core";
import type { JWTPayload } from "jose";
import { getAuth, mcpResource } from "./better-auth";
import { authenticateAgentCredential } from "./identity/agent-credentials";
import { authenticateApiKey } from "./auth";
import { memberContext } from "./identity/enrollment";
import { personalMemberContext } from "./identity/enrollment";
import { credentialVersion, credentialEpoch, personScope, withCredentialScope } from "./identity/credential-scope";
import { apiKeyId, bindApiKey, bindRole, memberRole } from "./analytics/events";
import { authCacheKey, cachedAuth } from "./auth-cache";

type Resolved = { ctx: HiveContext; role: ReturnType<typeof memberRole>; keyId: string | null };

// Contexts carry their role and key id in WeakMaps, so the cache keeps a snapshot and hands out fresh copies.
async function cachedContext(key: string, load: () => Promise<HiveContext | null>, notAfterMs?: number): Promise<HiveContext | null> {
  const resolved = await cachedAuth<Resolved>(key, async () => {
    const ctx = await load();
    return ctx ? { ctx: { ...ctx }, role: memberRole(ctx), keyId: apiKeyId(ctx) } : null;
  }, notAfterMs);
  if (!resolved) return null;
  const ctx = { ...resolved.ctx };
  if (resolved.role) bindRole(ctx, resolved.role);
  if (resolved.keyId) bindApiKey(ctx, resolved.keyId);
  return ctx;
}

async function currentCredentialEpoch() {
  return (await cachedAuth("credential-epoch", credentialEpoch))!;
}

export async function contextFromClaims(claims: JWTPayload): Promise<HiveContext | null> {
  if (typeof claims.hive_member_id !== "string" || typeof claims.hive_team_id !== "string" || claims.sub !== claims.hive_member_id) return null;
  if (claims.hive_credential_version !== credentialVersion || claims.hive_credential_epoch !== await currentCredentialEpoch()) return null;
  if (claims.hive_access === "person") {
    if (typeof claims.scope !== "string" || !claims.scope.split(" ").includes(personScope)) return null;
    const personal = await personalMemberContext(claims.hive_member_id);
    return personal?.teamId === claims.hive_team_id ? personal : null;
  }
  if (claims.hive_access !== "team" || typeof claims.scope !== "string" || claims.scope.split(" ").includes(personScope)) return null;
  return memberContext(claims.hive_member_id, claims.hive_team_id);
}

export async function withHiveBearerAuth(request: Request, handler: (request: Request, ctx: HiveContext, claims?: JWTPayload) => Promise<Response>) {
  const authorization = request.headers.get("authorization");
  const agentToken = authorization?.match(/^Bearer (ha_[A-Za-z0-9_-]{43})$/i)?.[1];
  if (agentToken) {
    const ctx = await cachedContext(authCacheKey("agent", agentToken), () => authenticateAgentCredential(agentToken));
    if (!ctx) return Response.json({ error: "This agent credential expired or was revoked." }, { status: 401 });
    return withCredentialScope(ctx.memberId, true, () => handler(request, ctx, { sub: ctx.memberId, hive_agent: true, scope: "hive" }));
  }
  const token = authorization?.match(/^Bearer (hm_[A-Za-z0-9_-]{43})$/i)?.[1];
  if (token) {
    const ctx = await cachedContext(authCacheKey("key", token), () => authenticateApiKey(token));
    if (ctx) return handler(request, ctx);
  }
  const auth = await getAuth();
  const resource = mcpResource(auth);
  return requireMcpAuth(auth, async (req, claims) => {
    if (claims.hive_credential_version !== credentialVersion || claims.hive_credential_epoch !== await currentCredentialEpoch()) return Response.json({ error: "Sign in to Hive again and allow access to your personal hive and organisations you join." }, { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } });
    // The signature, audience and expiry were just verified; only the membership lookup behind the token is reused.
    const accessToken = req.headers.get("authorization")?.replace(/^\S+\s+/, "") ?? "";
    const ctx = await cachedContext(authCacheKey("oauth", accessToken), () => contextFromClaims(claims), typeof claims.exp === "number" ? claims.exp * 1000 : undefined);
    if (!ctx) return Response.json({ error: "This token has no active membership in its hive." }, { status: 403 });
    return withCredentialScope(ctx.memberId, claims.hive_access === "person", () => handler(req, ctx, claims));
  }, { resource, requiredScopes: ["hive"], challengeScopes: ["hive", personScope] })(request);
}

