import { recordMembershipJoin } from "./join-receipts";
import type postgres from "postgres";

export async function followOwnerMemberships(tx: postgres.TransactionSql, ownerId: string) {
  const owners = await tx`SELECT id, provisional, email_verified FROM members WHERE id = ${ownerId} AND actor_type = 'human' AND disabled_at IS NULL FOR UPDATE`;
  if (!owners[0]) return;
  const memberships = await tx`SELECT h.team_id, t.personal_owner_member_id FROM hive_memberships h JOIN teams t ON t.id = h.team_id WHERE h.member_id = ${ownerId} AND h.removed_at IS NULL ORDER BY h.team_id FOR SHARE OF h`;
  const agents = await tx`SELECT m.id FROM hive_agent_owners b JOIN members m ON m.id = b.agent_member_id WHERE b.owner_member_id = ${ownerId} AND m.actor_type = 'agent' AND m.disabled_at IS NULL`;
  for (const membership of memberships) {
    if (!membership.personal_owner_member_id && (owners[0].provisional || !owners[0].email_verified)) continue;
    for (const agent of agents) {
      const added = await tx`INSERT INTO hive_memberships (member_id, team_id, role, owner_member_id) VALUES (${agent.id}, ${membership.team_id}, 'member', ${ownerId}) ON CONFLICT DO NOTHING RETURNING member_id`;
      if (added.length && !membership.personal_owner_member_id) await recordMembershipJoin(tx, agent.id, membership.team_id, 'owner');
    }
  }
}

export async function claimProvisionalHuman(tx: postgres.TransactionSql, memberId: string) {
  const rows = await tx`UPDATE members SET provisional = false, provisional_expires_at = NULL, updated_at = now() WHERE id = ${memberId} AND actor_type = 'human' AND email_verified AND disabled_at IS NULL AND provisional RETURNING id`;
  if (rows.length) await followOwnerMemberships(tx, memberId);
}
