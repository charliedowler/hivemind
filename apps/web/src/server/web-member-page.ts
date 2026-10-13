import type { HiveContext } from "@hivemind/core";
import { memberPage } from "./identity/member-page";
import { getSql } from "./db/client";
export async function webMemberPage(ctx: HiveContext) {
  const [data, rows] = await Promise.all([
    memberPage(ctx),
    getSql()`SELECT m.id, m.actor_type, b.owner_member_id, owner.name AS owner_name FROM members m JOIN hive_memberships h ON h.member_id = m.id LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' AND a.owner_email_verified LEFT JOIN agent_owner_bindings b ON b.owner_sub = a.owner_sub AND b.issuer = 'https://auth.agentid.com' LEFT JOIN members owner ON owner.id = b.owner_member_id AND owner.actor_type = 'human' WHERE h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL`,
  ]);
  const identity = new Map(rows.map((row) => [String(row.id), row]));
  return {
    ...data,
    members: data.members.map((member) => ({
      ...member,
      actorType: String(identity.get(member.id)?.actor_type ?? "human"),
      ownerId: identity.get(member.id)?.owner_member_id as string | null,
      ownerName: identity.get(member.id)?.owner_name as string | null,
    })),
  };
}
