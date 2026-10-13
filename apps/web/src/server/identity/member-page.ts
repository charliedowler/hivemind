import type { HiveContext } from "@hivemind/core";
import { listMembers, teamOverview } from "../hive";
import { getSql } from "../db/client";
export async function memberPage(ctx: HiveContext) {
  const [members, overview] = await Promise.all([
    listMembers(ctx),
    teamOverview(ctx),
  ]);
  const keys =
    overview.role === "admin"
      ? await getSql()`SELECT id, member_id, label, prefix, revoked_at FROM api_keys WHERE team_id = ${ctx.teamId} ORDER BY created_at DESC`
      : [];
  const agents = await getSql()`SELECT m.id, m.actor_type, a.owner_name FROM members m LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' JOIN hive_memberships h ON h.member_id = m.id WHERE h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL`;
  const identities = new Map(agents.map(row => [String(row.id), row]));
  return {
    members: members.map(member => ({ ...member, actorType: String(identities.get(member.id)?.actor_type ?? "human"), ownerName: identities.get(member.id)?.owner_name as string | null })),
    overview,
    keys: keys.map((key) => ({
      id: String(key.id),
      member_id: String(key.member_id),
      prefix: String(key.prefix),
      label: String(key.label),
      revoked_at: key.revoked_at?.toISOString() ?? null,
    })),
    memberId: ctx.memberId,
  };
}
