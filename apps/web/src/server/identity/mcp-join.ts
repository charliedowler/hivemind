import { joinOrRequest } from "./join-requests";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { HiveError } from "../errors";
import { joinByPhrase, normaliseJoinPhrase } from "./join-phrases";
import { agentIdIssuer } from "./owner-bindings";
import { joinPhraseRateLimit } from "./rate-limit";

export async function mcpJoin(ctx: HiveContext, input: string, options: {trustedProxyIp: string | null; sessionKind?: string}) {
  const actors = await getSql()`SELECT m.actor_type, b.owner_member_id FROM members m JOIN hive_memberships h ON h.member_id = m.id AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' AND a.owner_email_verified LEFT JOIN agent_owner_bindings b ON b.issuer = ${agentIdIssuer} AND b.owner_sub = a.owner_sub WHERE m.id = ${ctx.memberId} AND m.disabled_at IS NULL AND NOT m.provisional`;
  if (!actors[0]) throw new HiveError("Sign in first.", 401);
  const phrase = normaliseJoinPhrase(input);
  if (!phrase) throw new HiveError("Use the three-word hive phrase.", 400);
  if (actors[0].actor_type === "human" && options.sessionKind === "oauth") {
    const result = await joinOrRequest(ctx, phrase, options.trustedProxyIp);
    return result.status === "requested" ? {status: "requested"} : result;
  }
  const capabilities = actors[0].actor_type === "agent" ? await getSql()`SELECT c.token_hash FROM hive_join_capabilities c JOIN hive_join_phrases p ON p.team_id = c.team_id AND p.generation = c.generation AND p.retired_at IS NULL WHERE c.agent_member_id = ${ctx.memberId} AND c.owner_member_id = ${actors[0].owner_member_id ?? ""} AND p.phrase = ${phrase} AND c.revoked_at IS NULL AND c.expires_at > now() ORDER BY c.created_at DESC LIMIT 1` : [];
  if (capabilities[0]) {
    const joined = await joinByPhrase(ctx, phrase, {trustedProxyIp: options.trustedProxyIp, capabilityHash: String(capabilities[0].token_hash)});
    return {status: "joined", teamId: joined.teamId, teamName: joined.teamName};
  }
  await joinPhraseRateLimit(String(actors[0].owner_member_id ?? ctx.memberId), options.trustedProxyIp);
  return {status: "needs_human", joinUrl: `${process.env.PUBLIC_URL ?? "https://gohive.dev"}/j/${phrase}`};
}
