import type postgres from "postgres";

export async function recordMembershipJoin(tx: postgres.TransactionSql, memberId: string, teamId: string, via: "domain" | "phrase" | "invite" | "owner", joined = true) {
  if (joined) await tx`INSERT INTO join_share_offers (owner_member_id, team_id) SELECT m.id, t.id FROM members m CROSS JOIN teams t WHERE m.id = ${memberId} AND m.actor_type = 'human' AND t.id = ${teamId} AND t.personal_owner_member_id IS NULL ON CONFLICT DO NOTHING`;
  const id = `hive-enrollment-context:${memberId}`;
  await tx`INSERT INTO auth_verification (id,identifier,value,expires_at) VALUES (${id},${id},${JSON.stringify({teamId,via,joined})},now()+interval '15 minutes') ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at WHERE ${via} <> 'domain' OR auth_verification.expires_at <= now() OR auth_verification.value::jsonb->>'via' = 'domain'`;
}
