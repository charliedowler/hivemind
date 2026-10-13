import { accessEvent, bindRole } from "../analytics/events";
import { earlyAccessIdForEmail } from "../analytics/linkages";
import type { HiveContext } from "@hivemind/core";
import { hiveRegistration, type HiveRegistration } from "@/lib/hive-registration";
import { getSql } from "../db/client";
import { hashToken, newId, newToken } from "../db/ids";
import { HiveError, HiveInputError } from "../errors";
import { emailDomain, isPublicDomain } from "./email-domain";
import { enrollAgent, isAgentMember, ownerInviteRole } from "./agent-enrollment";
import { claimProvisionalHuman, followOwnerMemberships } from "./owner-bindings";

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
  const rows = await sql`SELECT m.id, m.name, h.role, h.team_id, t.name AS team_name FROM members m JOIN hive_memberships h ON h.member_id = m.id JOIN teams t ON t.id = h.team_id WHERE m.id = ${memberId} AND m.disabled_at IS NULL AND NOT m.provisional AND h.removed_at IS NULL ${teamId ? sql`AND h.team_id = ${teamId}` : sql``} AND (h.owner_member_id IS NULL OR EXISTS (SELECT 1 FROM hive_memberships owner_h JOIN members owner_m ON owner_m.id = owner_h.member_id WHERE owner_h.member_id = h.owner_member_id AND owner_h.team_id = h.team_id AND owner_h.removed_at IS NULL AND owner_m.disabled_at IS NULL AND (t.personal_owner_member_id IS NOT NULL OR (owner_m.email_verified AND NOT owner_m.provisional)))) ORDER BY (h.team_id = m.team_id) DESC, (t.personal_owner_member_id IS NOT NULL) DESC, h.joined_at, h.team_id LIMIT 1`;
  return rows[0] ? bindRole({ memberId: rows[0].id, memberName: rows[0].name, teamId: rows[0].team_id, teamName: rows[0].team_name }, rows[0].role) : null;
}

export async function enrollMember(memberId: string, input?: HiveRegistration): Promise<HiveContext | null> {
  if (await isAgentMember(memberId)) return enrollAgent(memberId, input);
  const enrollment = await getSql().begin(async (tx) => {
    const rows = await tx`SELECT * FROM members WHERE id = ${memberId} FOR UPDATE`;
    const member = rows[0];
    if (!member || member.disabled_at) throw new HiveError("This identity is no longer active.", 403);
    if (!member.email_verified || !member.email) throw new HiveError("Verify your email before joining a hive.", 403);
    await claimProvisionalHuman(tx, memberId);
    const personal = (await tx`SELECT hive_ensure_personal_hive(${memberId}) AS id`)[0].id;
    const registration = input ? JSON.parse(registrationForStorage(input)!) : member.hive_registration ? JSON.parse(member.hive_registration) : null;
    const existing = await tx`SELECT h.team_id FROM hive_memberships h JOIN teams t ON t.id = h.team_id WHERE h.member_id = ${memberId} AND h.team_id = ${member.team_id ?? ""} AND h.removed_at IS NULL AND t.personal_owner_member_id IS NULL`;
    if (existing.length && !registration) {
      await followOwnerMemberships(tx, memberId);
      return;
    }
    let teamId: string = personal;
    let intent: "create" | "invite" | "domain" | null = null;
    if (registration?.intent === "create") {
      teamId = newId("team"); intent = "create";
      await tx`INSERT INTO teams (id, name, invite_code) VALUES (${teamId}, ${registration.teamName}, ${hashToken(`hive-${newToken()}`)})`;
    } else if (registration?.intent === "invite") {
      const teams = await tx`SELECT id FROM teams WHERE invite_code = ${registration.inviteCode} AND invite_expires_at > now() AND personal_owner_member_id IS NULL FOR UPDATE`;
      if (!teams[0]) throw new HiveInputError("This invite has expired or is not valid. Ask your team admin for a new invite.");
      teamId = teams[0].id; intent = "invite";
    } else {
      const domain = emailDomain(member.email);
      if (domain && !isPublicDomain(domain)) {
        const teams = await tx`SELECT t.id FROM teams t JOIN team_domains d ON d.team_id = t.id WHERE d.domain = ${domain} AND t.personal_owner_member_id IS NULL FOR UPDATE OF t`;
        if (teams[0]) { teamId = teams[0].id; intent = "domain"; }
      }
      if (!intent && input) throw new HiveInputError("Your work domain has no hive yet. Ask your team admin for an invite.");
    }
    const role = intent === "create" || teamId === personal ? "admin" : intent === "invite" ? await ownerInviteRole(tx, memberId, member.email, teamId, registration.inviteCode) : "member";
    await tx`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${memberId}, ${teamId}, ${role}) ON CONFLICT DO NOTHING`;
    const active = await tx`SELECT role FROM hive_memberships WHERE member_id = ${memberId} AND team_id = ${teamId} AND removed_at IS NULL`;
    if (!active.length) throw new HiveError("This membership was removed. Ask your team admin.", 403);
    await tx`UPDATE members SET team_id = ${teamId}, role = ${active[0].role}, removed_at = NULL, hive_registration = NULL, updated_at = now() WHERE id = ${memberId}`;
    if (intent === "create") await tx`SELECT hive_create_default_capture_rules(${teamId}, ${memberId})`;
    await tx`UPDATE web_sessions SET team_id = ${teamId} WHERE member_id = ${memberId} AND team_id IS NULL`;
    await followOwnerMemberships(tx, memberId);
    return { intent, email: member.email as string, promoted: intent === "create" && member.role !== "admin" };
  });
  const ctx = await memberContext(memberId);
  if (ctx && enrollment?.intent) {
    await accessEvent(ctx, "signup", { earlyAccessId: await earlyAccessIdForEmail(enrollment.email) }, `enrollment:${memberId}:${ctx.teamId}`);
    await accessEvent(ctx, enrollment.intent === "create" ? "invite_created" : enrollment.intent === "invite" ? "invite_accepted" : "domain_join", {}, `enrollment:${memberId}:${ctx.teamId}`);
    if (enrollment.promoted) await accessEvent(ctx, "role_changed", { role: "admin", targetMemberId: memberId }, `enrollment:${memberId}:${ctx.teamId}`);
  }
  return ctx;
}
