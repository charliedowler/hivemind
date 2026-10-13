import { recordMembershipJoin } from "./join-receipts";
import type postgres from "postgres";
import { newId } from "../db/ids";
import { HiveError } from "../errors";

export const agentIdIssuer = "https://auth.agentid.com";
export type VerifiedAgentOwner = { sub: string; email: string; name?: string };

export async function bindVerifiedOwner(tx: postgres.TransactionSql, owner: VerifiedAgentOwner, canProvision: boolean) {
  const email = owner.email.trim().toLowerCase();
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`owner:${agentIdIssuer}:${owner.sub}`}))`;
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`identity-email:${email}`}))`;
  const bindings = await tx`SELECT b.*, m.actor_type, m.disabled_at, m.provisional, m.email_verified, m.email FROM agent_owner_bindings b JOIN members m ON m.id = b.owner_member_id WHERE b.issuer = ${agentIdIssuer} AND b.owner_sub = ${owner.sub} FOR UPDATE OF b, m`;
  if (bindings[0]) {
    const binding = bindings[0];
    if (binding.verified_contact_email !== email || binding.email !== email || binding.actor_type !== "human" || binding.disabled_at || (!binding.provisional && !binding.email_verified)) throw new HiveError("This owner identity cannot be linked. Sign in with the human account.", 403);
    return String(binding.owner_member_id);
  }
  if (!canProvision) return null;
  const members = await tx`SELECT * FROM members WHERE email = ${email} FOR UPDATE`;
  let memberId: string;
  if (members[0]) {
    const member = members[0];
    const passwords = await tx`SELECT id FROM auth_accounts WHERE user_id = ${member.id} AND password IS NOT NULL`;
    if (member.actor_type !== "human" || member.disabled_at || (!member.email_verified && !member.provisional) || (member.provisional && passwords.length)) throw new HiveError("This owner identity cannot be linked. Sign in with the human account.", 403);
    memberId = String(member.id);
  } else {
    memberId = newId("mem");
    const name = owner.name?.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 80) || "Your Hive";
    await tx`INSERT INTO members (id, name, email, email_verified, provisional) VALUES (${memberId}, ${name}, ${email}, false, true)`;
  }
  await tx`SELECT hive_ensure_personal_hive(${memberId})`;
  await tx`INSERT INTO agent_owner_bindings (issuer, owner_sub, owner_member_id, verified_contact_email, verified_contact_name) VALUES (${agentIdIssuer}, ${owner.sub}, ${memberId}, ${email}, ${owner.name ?? null})`;
  return memberId;
}

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
