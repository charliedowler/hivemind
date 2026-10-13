import { getSql } from "../db/client";
export async function expireProvisionalHumans() {
  return getSql().begin(async tx => {
    const expired = await tx`SELECT id FROM members WHERE actor_type = 'human' AND provisional AND NOT email_verified AND disabled_at IS NULL AND provisional_expires_at <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100`;
    for (const owner of expired) {
      const personal = await tx`SELECT id FROM teams WHERE personal_owner_member_id = ${owner.id}`;
      if (!personal[0]) continue;
      const teamId = String(personal[0].id);
      await tx`UPDATE members SET disabled_at = now() WHERE id = ${owner.id} OR id IN (SELECT agent_member_id FROM hive_agent_owners WHERE owner_member_id = ${owner.id})`;
      await tx`UPDATE agent_credentials SET revoked_at = now() WHERE owner_member_id = ${owner.id}`;
      await tx`DELETE FROM conflict_decisions WHERE team_id = ${teamId}`;
      await tx`DELETE FROM learning_pushes WHERE team_id = ${teamId}`;
      await tx`DELETE FROM learnings WHERE team_id = ${teamId} AND owner_member_id = ${owner.id}`;
      await tx`DELETE FROM ask_log WHERE team_id = ${teamId}`;
      await tx`DELETE FROM knowledge_snapshots WHERE team_id = ${teamId} OR ${teamId} = ANY(audience_team_ids)`;
      await tx`DELETE FROM auth_verification WHERE id = ${`hive-welcome:${owner.id}`}`;
    }
    return { expired: expired.length };
  });
}
