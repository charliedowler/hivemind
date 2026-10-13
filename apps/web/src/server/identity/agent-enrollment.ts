import type postgres from "postgres";
import { z } from "zod";
import type { HiveContext } from "@hivemind/core";
import type { HiveRegistration } from "@/lib/hive-registration";
import { getSql } from "../db/client";
import { HiveError, HiveInputError } from "../errors";
import { memberContext, registrationForStorage } from "./enrollment";
import { agentIdIssuer, bindVerifiedOwner, followOwnerMemberships } from "./owner-bindings";
import { deliverWelcome } from "./welcome";

export const agentClaims = z.object({
  sub: z.string().min(1),
  actor_type: z.literal("agent"),
  email: z.email(),
  email_verified: z.literal(true),
  owner_sub: z.string().min(1).optional(),
  owner_name: z.string().trim().min(1).max(200).optional(),
  owner_email: z.email().optional(),
  owner_email_verified: z.boolean().optional(),
});

export async function isAgentMember(memberId: string): Promise<boolean> {
  const rows = await getSql()`SELECT actor_type FROM members WHERE id = ${memberId}`;
  return rows[0]?.actor_type === "agent";
}

export async function requireHuman(memberId: string): Promise<void> {
  const rows = await getSql()`SELECT id FROM members WHERE id = ${memberId} AND actor_type = 'human' AND NOT provisional AND disabled_at IS NULL`;
  if (!rows.length) throw new HiveError("Ask a human team admin to change access or settings.", 403);
}

export function ownerJoinDecision(teams: { id: string; name: string }[]) {
  return teams.length === 1 ? { kind: "join" as const, team: teams[0] } : teams.length > 1 ? { kind: "choose" as const, teams } : { kind: "onboard" as const };
}

export async function ownerTeams(memberId: string) {
  const rows = await getSql()`SELECT DISTINCT t.id, t.name FROM auth_accounts a JOIN members agent ON agent.id = a.user_id JOIN agent_owner_bindings b ON b.issuer = ${agentIdIssuer} AND b.owner_sub = a.owner_sub JOIN members human ON human.id = b.owner_member_id JOIN hive_memberships h ON h.member_id = human.id JOIN teams t ON t.id = h.team_id WHERE a.user_id = ${memberId} AND a.provider_id = 'agentid' AND a.owner_email_verified AND agent.actor_type = 'agent' AND agent.disabled_at IS NULL AND human.actor_type = 'human' AND human.email_verified AND NOT human.provisional AND human.disabled_at IS NULL AND h.removed_at IS NULL AND t.personal_owner_member_id IS NULL ORDER BY t.name, t.id`;
  return rows.map(row => ({ id: String(row.id), name: String(row.name) }));
}

export async function storeAgentOwner(account: { id: string; userId: string; accountId: string; providerId: string; accessToken?: string | null }, displayName?: unknown) {
  if (account.providerId !== "agentid") return;
  if (!account.accessToken) throw new HiveError("AgentID did not return an access token.", 403);
  const response = await fetch(`${agentIdIssuer}/v0/userinfo`, { headers: { Authorization: `Bearer ${account.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new HiveError("AgentID could not verify this agent.", 403);
  const claims = agentClaims.parse({ ...await response.json(), actor_type: "agent" });
  if (claims.sub !== account.accountId) throw new HiveError("AgentID returned a different agent identity.", 403);
  const verified = claims.owner_email_verified === true && Boolean(claims.owner_email && claims.owner_sub);
  await getSql().begin(async tx => {
    const rows = await tx`SELECT a.*, m.actor_type FROM auth_accounts a JOIN members m ON m.id = a.user_id WHERE a.id = ${account.id} AND a.provider_id = 'agentid' AND a.account_id = ${claims.sub} AND a.user_id = ${account.userId} FOR UPDATE OF a`;
    if (!rows[0] || rows[0].actor_type !== "agent") throw new HiveError("Agent and human accounts stay separate.", 403);
    if (rows[0].owner_sub && (rows[0].owner_sub !== claims.owner_sub || rows[0].owner_email !== claims.owner_email?.toLowerCase() || !verified)) throw new HiveError("This agent's owner changed. Sign in with the human account.", 403);
    if (verified) await bindVerifiedOwner(tx, { sub: claims.owner_sub!, email: claims.owner_email!, name: claims.owner_name }, Boolean(process.env.AGENTID_CLIENT_SECRET));
    await tx`UPDATE auth_accounts SET owner_issuer = ${claims.owner_sub ? agentIdIssuer : null}, owner_sub = ${claims.owner_sub ?? null}, owner_name = ${claims.owner_name ?? null}, owner_email = ${verified ? claims.owner_email!.toLowerCase() : null}, owner_email_verified = ${verified} WHERE id = ${account.id}`;
  });
  if (typeof displayName === "string") await setFirstAgentName(account.userId, displayName);
  await enrollAgent(account.userId);
  const owners = await getSql()`SELECT b.owner_member_id FROM agent_owner_bindings b WHERE b.issuer = ${agentIdIssuer} AND b.owner_sub = ${claims.owner_sub ?? ""}`;
  if (owners[0]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await deliverWelcome(owners[0].owner_member_id); } catch { break; }
    }
  }
}

export async function setFirstAgentName(memberId: string, input: string) {
  const label = input.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[^\p{L}\p{N} ._()-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!label) return;
  await getSql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`agent-name:${label}`}))`;
    const members = await tx`SELECT id FROM members WHERE id = ${memberId} AND actor_type = 'agent' AND NOT EXISTS (SELECT 1 FROM hive_memberships WHERE member_id = ${memberId}) FOR UPDATE`;
    if (!members.length) return;
    let name = label;
    for (let index = 2; (await tx`SELECT id FROM members WHERE name = ${name} AND id <> ${memberId} AND actor_type = 'agent'`).length; index++) name = `${label.slice(0, 80 - String(index).length - 1)} ${index}`;
    await tx`UPDATE members SET name = ${name}, updated_at = now() WHERE id = ${memberId}`;
  });
}

export async function enrollAgent(memberId: string, input?: HiveRegistration, selectedTeam?: string): Promise<HiveContext | null> {
  await getSql().begin(async tx => {
    const rows = await tx`SELECT m.*, a.owner_sub, b.owner_member_id FROM members m LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' AND a.owner_email_verified LEFT JOIN agent_owner_bindings b ON b.issuer = ${agentIdIssuer} AND b.owner_sub = a.owner_sub WHERE m.id = ${memberId}`;
    const member = rows[0];
    if (!member || member.disabled_at || member.actor_type !== "agent") throw new HiveError("This agent identity is no longer active.", 403);
    if (!member.email_verified) throw new HiveError("Sign in with AgentID before joining a hive.", 403);
    if (input?.intent === "create") throw new HiveError("Only a human can create an organisation hive.", 403);
    if (input?.intent === "domain") throw new HiveInputError("Agents join through an invite or their verified owner. Choose a team below.");
    if (member.owner_member_id) await followOwnerMemberships(tx, member.owner_member_id);
    await tx`SELECT id FROM members WHERE id = ${memberId} FOR UPDATE`;
    const registration = input ? JSON.parse(registrationForStorage(input)!) : member.hive_registration ? JSON.parse(member.hive_registration) : null;
    let teamId: string | undefined;
    if (registration?.intent === "create") throw new HiveError("Only a human can create an organisation hive.", 403);
    if (registration?.intent === "invite") {
      const teams = await tx`SELECT id FROM teams WHERE invite_code = ${registration.inviteCode} AND invite_expires_at > now() AND personal_owner_member_id IS NULL FOR UPDATE`;
      if (!teams[0]) throw new HiveInputError("This invite has expired or is not valid. Ask your team admin for a new invite.");
      teamId = teams[0].id;
      await tx`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${memberId}, ${teamId!}, 'member') ON CONFLICT DO NOTHING`;
    } else if (selectedTeam) {
      const owned = await tx`SELECT h.team_id FROM hive_memberships h JOIN teams t ON t.id = h.team_id JOIN members human ON human.id = h.member_id WHERE human.disabled_at IS NULL AND human.email_verified AND NOT human.provisional AND h.member_id = ${member.owner_member_id ?? ""} AND h.team_id = ${selectedTeam} AND h.removed_at IS NULL AND t.personal_owner_member_id IS NULL`;
      if (!owned.length) throw new HiveError("Your verified owner is not a member of this team.", 403);
      teamId = selectedTeam;
    } else {
      const current = await tx`SELECT team_id FROM hive_memberships WHERE member_id = ${memberId} AND team_id = ${member.team_id ?? ""} AND removed_at IS NULL`;
      if (current.length) return;
      const choices = await tx`SELECT h.team_id FROM hive_memberships h JOIN teams t ON t.id = h.team_id WHERE h.member_id = ${memberId} AND h.removed_at IS NULL ORDER BY (t.personal_owner_member_id IS NULL) DESC, h.joined_at, h.team_id`;
      teamId = choices[0]?.team_id;
    }
    if (!teamId) return;
    const active = await tx`SELECT team_id FROM hive_memberships WHERE member_id = ${memberId} AND team_id = ${teamId} AND removed_at IS NULL`;
    if (!active.length) throw new HiveError("This membership was removed. Ask your team admin.", 403);
    await tx`UPDATE members SET team_id = ${teamId}, role = 'member', removed_at = NULL, hive_registration = NULL, updated_at = now() WHERE id = ${memberId}`;
    await tx`UPDATE web_sessions SET team_id = ${teamId} WHERE member_id = ${memberId} AND team_id IS NULL`;
  });
  return memberContext(memberId);
}

export async function ownerInviteRole(tx: postgres.TransactionSql, memberId: string, email: string, teamId: string, inviteHash: string): Promise<"member" | "admin"> {
  const rows = await tx`UPDATE agent_owner_invites SET accepted_by = ${memberId} WHERE team_id = ${teamId} AND invite_hash = ${inviteHash} AND owner_email = ${email.toLowerCase()} AND expires_at > now() AND accepted_by IS NULL RETURNING team_id`;
  return rows.length ? "admin" : "member";
}

export async function agentEnrollmentNotice(memberId: string) {
  const rows = await getSql()`SELECT t.name, a.owner_name FROM members m JOIN hive_memberships h ON h.member_id = m.id AND h.team_id = m.team_id AND h.removed_at IS NULL JOIN teams t ON t.id = h.team_id LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' WHERE m.id = ${memberId} AND m.actor_type = 'agent' AND m.disabled_at IS NULL`;
  const row = rows[0];
  return row ? row.owner_name ? `You're in ${row.name}, joined via ${row.owner_name}.` : `You're in ${row.name}.` : null;
}
