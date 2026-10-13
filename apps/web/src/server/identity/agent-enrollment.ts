import type postgres from "postgres";
import type { HiveContext } from "@hivemind/core";
import type { HiveRegistration } from "@/lib/hive-registration";
import { getSql } from "../db/client";
import { HiveError } from "../errors";
import { memberContext } from "./enrollment";
import { followOwnerMemberships } from "./owner-bindings";

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
  const rows = await getSql()`SELECT DISTINCT t.id, t.name FROM hive_agent_owners a JOIN members agent ON agent.id = a.agent_member_id JOIN members human ON human.id = a.owner_member_id JOIN hive_memberships h ON h.member_id = human.id JOIN teams t ON t.id = h.team_id WHERE a.agent_member_id = ${memberId} AND agent.actor_type = 'agent' AND agent.disabled_at IS NULL AND human.actor_type = 'human' AND human.email_verified AND NOT human.provisional AND human.disabled_at IS NULL AND h.removed_at IS NULL AND t.personal_owner_member_id IS NULL ORDER BY t.name, t.id`;
  return rows.map(row => ({ id: String(row.id), name: String(row.name) }));
}

export async function enrollAgent(memberId: string, input?: HiveRegistration, selectedTeam?: string): Promise<HiveContext | null> {
  const teamId = await getSql().begin(async tx => {
    const rows = await tx`SELECT m.id, m.disabled_at, a.owner_member_id FROM members m LEFT JOIN hive_agent_owners a ON a.agent_member_id = m.id WHERE m.id = ${memberId} AND m.actor_type = 'agent'`;
    if (!rows[0] || rows[0].disabled_at) throw new HiveError("This agent credential is no longer active.", 403);
    if (input) throw new HiveError("Ask the owner to join the hive. Agents use their owner's memberships.", 403);
    if (rows[0].owner_member_id) await followOwnerMemberships(tx, rows[0].owner_member_id);
    const memberships = await tx`SELECT h.team_id FROM hive_memberships h JOIN teams t ON t.id = h.team_id WHERE h.member_id = ${memberId} AND h.removed_at IS NULL ORDER BY (t.personal_owner_member_id IS NOT NULL) DESC, h.joined_at, h.team_id`;
    if (selectedTeam && !memberships.some(row => row.team_id === selectedTeam)) throw new HiveError("The agent is not a member of this hive.", 403);
    return selectedTeam ?? memberships[0]?.team_id;
  });
  return teamId ? memberContext(memberId, teamId) : null;
}

export async function ownerInviteRole(tx: postgres.TransactionSql, memberId: string, email: string, teamId: string, inviteHash: string): Promise<"member" | "admin"> {
  const rows = await tx`UPDATE agent_owner_invites SET accepted_by = ${memberId} WHERE team_id = ${teamId} AND invite_hash = ${inviteHash} AND owner_email = ${email.toLowerCase()} AND expires_at > now() AND accepted_by IS NULL RETURNING team_id`;
  return rows.length ? "admin" : "member";
}

export async function agentEnrollmentNotice(memberId: string) {
  const rows = await getSql()`SELECT t.name, owner.name AS owner_name FROM members m JOIN hive_memberships h ON h.member_id = m.id AND h.removed_at IS NULL JOIN teams t ON t.id = h.team_id LEFT JOIN hive_agent_owners a ON a.agent_member_id = m.id LEFT JOIN members owner ON owner.id = a.owner_member_id WHERE m.id = ${memberId} AND m.actor_type = 'agent' AND m.disabled_at IS NULL ORDER BY (t.personal_owner_member_id IS NOT NULL) DESC, h.joined_at, h.team_id LIMIT 1`;
  const row = rows[0];
  return row ? row.owner_name ? `You're in ${row.name}, joined via ${row.owner_name}.` : `You're in ${row.name}.` : null;
}
