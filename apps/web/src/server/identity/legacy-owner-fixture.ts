import type postgres from "postgres";
import { newId } from "../db/ids";
import { HiveError } from "../errors";
export { followOwnerMemberships } from "./owner-bindings";

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

