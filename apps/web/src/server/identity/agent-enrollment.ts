import type postgres from "postgres";
import { z } from "zod";
import type { HiveContext } from "@hivemind/core";
import type { HiveRegistration } from "@/lib/hive-registration";
import { getSql } from "../db/client";
import { hashToken, newId, newToken } from "../db/ids";
import { HiveError, HiveInputError } from "../errors";
import { memberContext, registrationForStorage } from "./enrollment";
import { deliverInvite } from "./email";

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
  if (await isAgentMember(memberId)) throw new HiveError("Ask a human team admin to change access or settings.", 403);
}

export function ownerJoinDecision(teams: { id: string; name: string }[]) {
  return teams.length === 1 ? { kind: "join" as const, team: teams[0] } : teams.length > 1 ? { kind: "choose" as const, teams } : { kind: "onboard" as const };
}

export async function ownerTeams(memberId: string) {
  const rows = await getSql()`SELECT DISTINCT t.id, t.name FROM auth_accounts a JOIN members agent ON agent.id = a.user_id JOIN members human ON lower(human.email) = a.owner_email JOIN teams t ON t.id = human.team_id WHERE a.user_id = ${memberId} AND a.provider_id = 'agentid' AND a.owner_email_verified AND agent.actor_type = 'agent' AND agent.removed_at IS NULL AND human.actor_type = 'human' AND human.email_verified AND human.removed_at IS NULL ORDER BY t.name, t.id`;
  return rows.map(row => ({ id: String(row.id), name: String(row.name) }));
}

export async function storeAgentOwner(account: { id: string; userId: string; accountId: string; providerId: string; accessToken?: string | null }) {
  if (account.providerId !== "agentid") return;
  if (!account.accessToken) throw new HiveError("AgentID did not return an access token.", 403);
  const response = await fetch("https://auth.agentid.com/v0/userinfo", { headers: { Authorization: `Bearer ${account.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new HiveError("AgentID could not verify this agent.", 403);
  const claims = agentClaims.parse({ ...await response.json(), actor_type: "agent" });
  if (claims.sub !== account.accountId) throw new HiveError("AgentID returned a different agent identity.", 403);
  const verified = claims.owner_email_verified === true;
  await getSql()`UPDATE auth_accounts SET owner_sub = ${claims.owner_sub ?? null}, owner_name = ${claims.owner_name ?? null}, owner_email = ${verified && claims.owner_email ? claims.owner_email.toLowerCase() : null}, owner_email_verified = ${verified} WHERE id = ${account.id} AND provider_id = 'agentid' AND account_id = ${claims.sub}`;
  await enrollAgent(account.userId);
}

export async function enrollAgent(memberId: string, input?: HiveRegistration, selectedTeam?: string): Promise<HiveContext | null> {
  let ownerInvitation: { email: string; code: string; teamName: string; teamId: string } | undefined;
  await getSql().begin(async tx => {
    const rows = await tx`SELECT m.*, a.owner_email, a.owner_name FROM members m LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' AND a.owner_email_verified WHERE m.id = ${memberId} FOR UPDATE OF m`;
    const member = rows[0];
    if (!member || member.removed_at || member.actor_type !== "agent") throw new HiveError("This agent membership is no longer active.", 403);
    if (member.team_id) return;
    if (!member.email_verified) throw new HiveError("Sign in with AgentID before joining a hive.", 403);
    const registration = input ? JSON.parse(registrationForStorage(input)!) : member.hive_registration ? JSON.parse(member.hive_registration) : null;
    let teamId: string | undefined;
    if (registration?.intent === "invite") {
      const teams = await tx`SELECT id FROM teams WHERE invite_code = ${registration.inviteCode} AND invite_expires_at > now() FOR UPDATE`;
      if (!teams[0]) throw new HiveInputError("This invite has expired or is not valid. Ask your team admin for a new invite.");
      teamId = teams[0].id;
    } else if (registration?.intent === "create") {
      teamId = newId("team");
      const code = `hive-${newToken()}`;
      await tx`INSERT INTO teams (id, name, invite_code) VALUES (${teamId}, ${registration.teamName}, ${hashToken(code)})`;
      if (member.owner_email) {
        await tx`INSERT INTO agent_owner_invites (team_id, agent_id, owner_email, invite_hash) VALUES (${teamId}, ${memberId}, ${member.owner_email}, ${hashToken(code)})`;
        ownerInvitation = { email: member.owner_email, code, teamName: registration.teamName, teamId: teamId! };
      }
    } else {
      if (input?.intent === "domain") throw new HiveInputError("Agents join through an invite or their verified owner. Choose a team below.");
      const teams = await tx`SELECT t.id, t.name FROM members human JOIN teams t ON t.id = human.team_id WHERE lower(human.email) = ${member.owner_email ?? ""} AND human.actor_type = 'human' AND human.email_verified AND human.removed_at IS NULL ORDER BY t.name, t.id FOR SHARE OF human, t`;
      const decision = ownerJoinDecision(teams.map(row => ({ id: String(row.id), name: String(row.name) })));
      if (selectedTeam) {
        if (!teams.some(team => team.id === selectedTeam)) throw new HiveError("Your verified owner is not a member of this team.", 403);
        teamId = selectedTeam;
      } else if (decision.kind === "join") teamId = decision.team.id;
    }
    if (!teamId) return;
    await tx`UPDATE members SET team_id = ${teamId}, role = 'member', hive_registration = NULL, updated_at = now() WHERE id = ${memberId}`;
    if (registration?.intent === "create") await tx`SELECT hive_create_default_capture_rules(${teamId}, ${memberId})`;
    await tx`UPDATE web_sessions SET team_id = ${teamId} WHERE member_id = ${memberId} AND team_id IS NULL`;
  });
  if (ownerInvitation) {
    const invite = ownerInvitation as { email: string; code: string; teamName: string; teamId: string };
    const { publicUrl } = await import("@/lib/public-url");
    const url = `${await publicUrl()}/app/login?invite=${encodeURIComponent(invite.code)}`;
    if (await deliverInvite(invite.email, invite.teamName, url, invite.teamId)) await getSql()`UPDATE agent_owner_invites SET delivered_at = now() WHERE team_id = ${invite.teamId}`;
  }
  return memberContext(memberId);
}

export async function ownerInviteRole(tx: postgres.TransactionSql, memberId: string, email: string, teamId: string, inviteHash: string): Promise<"member" | "admin"> {
  const rows = await tx`UPDATE agent_owner_invites SET accepted_by = ${memberId} WHERE team_id = ${teamId} AND invite_hash = ${inviteHash} AND owner_email = ${email.toLowerCase()} AND expires_at > now() AND accepted_by IS NULL RETURNING team_id`;
  return rows.length ? "admin" : "member";
}

export async function agentEnrollmentNotice(memberId: string) {
  const rows = await getSql()`SELECT t.name, a.owner_name, i.delivered_at, i.team_id AS invited_team FROM members m JOIN teams t ON t.id = m.team_id LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' LEFT JOIN agent_owner_invites i ON i.team_id = m.team_id AND i.agent_id = m.id WHERE m.id = ${memberId} AND m.actor_type = 'agent'`;
  const row = rows[0];
  if (!row) return null;
  if (row.invited_team) return row.delivered_at ? `You're in ${row.name}. Your owner was invited.` : `You're in ${row.name}. The owner invite could not be sent. Ask your owner to contact Hive.`;
  return row.owner_name ? `You're in ${row.name}, joined via ${row.owner_name}.` : `You're in ${row.name}.`;
}
