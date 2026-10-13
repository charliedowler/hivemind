import { accessEvent, bindRole } from "../analytics/events";
import { earlyAccessIdForEmail } from "../analytics/linkages";
import type { HiveContext } from "@hivemind/core";
import { hiveRegistration, type HiveRegistration } from "@/lib/hive-registration";
import { getSql } from "../db/client";
import { hashToken, newId, newToken } from "../db/ids";
import { HiveError, HiveInputError } from "../errors";
import { emailDomain, isPublicDomain } from "./email-domain";
import { enrollAgent, isAgentMember, ownerInviteRole } from "./agent-enrollment";

export function registrationForStorage(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = hiveRegistration.parse(typeof value === "string" ? JSON.parse(value) : value);
  if (parsed.intent !== "invite") return JSON.stringify(parsed);
  let code = parsed.inviteCode;
  try { code = new URL(code).searchParams.get("invite") || code; } catch {}
  return JSON.stringify({ ...parsed, inviteCode: hashToken(code) });
}

export async function memberContext(memberId: string, teamId?: string): Promise<HiveContext | null> {
  const sql = getSql();
  const rows = await sql`SELECT m.id, m.name, m.role, m.team_id, t.name AS team_name FROM members m JOIN teams t ON t.id = m.team_id WHERE m.id = ${memberId} AND m.removed_at IS NULL ${teamId ? sql`AND m.team_id = ${teamId}` : sql``}`;
  return rows[0] ? bindRole({ memberId: rows[0].id, memberName: rows[0].name, teamId: rows[0].team_id, teamName: rows[0].team_name }, rows[0].role) : null;
}

export async function enrollMember(memberId: string, input?: HiveRegistration): Promise<HiveContext | null> {
  if (await isAgentMember(memberId)) return enrollAgent(memberId, input);
  const enrollment = await getSql().begin(async (tx) => {
    const rows = await tx`SELECT * FROM members WHERE id = ${memberId} FOR UPDATE`;
    const member = rows[0];
    if (!member || member.removed_at) throw new HiveError("This membership is no longer active.", 403);
    if (member.team_id) return;
    if (!member.email_verified || !member.email) throw new HiveError("Verify your email before joining a hive.", 403);
    const registration = input ? JSON.parse(registrationForStorage(input)!) : member.hive_registration ? JSON.parse(member.hive_registration) : { intent: "domain" };
    let teamId: string;
    if (registration.intent === "create") {
      teamId = newId("team");
      await tx`INSERT INTO teams (id, name, invite_code) VALUES (${teamId}, ${registration.teamName}, ${hashToken(`hive-${newToken()}`)})`;
    } else if (registration.intent === "invite") {
      const teams = await tx`SELECT id FROM teams WHERE invite_code = ${registration.inviteCode} AND invite_expires_at > now() FOR UPDATE`;
      if (!teams[0]) throw new HiveInputError("This invite has expired or is not valid. Ask your team admin for a new invite.");
      teamId = teams[0].id;
    } else {
      const domain = emailDomain(member.email);
      if (!domain || isPublicDomain(domain)) {
        if (input) throw new HiveInputError("Your email domain cannot join this hive. Ask your team admin for an invite.");
        return;
      }
      const teams = await tx`SELECT t.id FROM teams t JOIN team_domains d ON d.team_id = t.id WHERE d.domain = ${domain} FOR UPDATE OF t`;
      if (!teams[0]) {
        if (input) throw new HiveInputError("Your work domain has no hive yet. Ask your team admin for an invite.");
        return;
      }
      teamId = teams[0].id;
    }
    const role = registration.intent === "create" ? "admin" : registration.intent === "invite" ? await ownerInviteRole(tx, memberId, member.email, teamId, registration.inviteCode) : "member";
    await tx`UPDATE members SET team_id = ${teamId}, role = ${role}, hive_registration = NULL, updated_at = now() WHERE id = ${memberId} AND team_id IS NULL AND removed_at IS NULL`;
    if (registration.intent === "create") await tx`SELECT hive_create_default_capture_rules(${teamId}, ${memberId})`;
    await tx`UPDATE web_sessions SET team_id = ${teamId} WHERE member_id = ${memberId} AND team_id IS NULL`;
    return { intent: registration.intent as "create" | "invite" | "domain", email: member.email as string, promoted: registration.intent === "create" && member.role !== "admin" };

  });
  const ctx = await memberContext(memberId);
  if (ctx && enrollment) {
    await accessEvent(ctx, "signup", { earlyAccessId: await earlyAccessIdForEmail(enrollment.email) }, `enrollment:${memberId}`);
    await accessEvent(ctx, enrollment.intent === "create" ? "invite_created" : enrollment.intent === "invite" ? "invite_accepted" : "domain_join", {}, `enrollment:${memberId}`);
    if (enrollment.promoted) await accessEvent(ctx, "role_changed", { role: "admin", targetMemberId: memberId }, `enrollment:${memberId}`);
  }
  return ctx;
}
