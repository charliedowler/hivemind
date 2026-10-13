import { cache } from "react";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { enrollMember, listHiveContexts, memberContext, personalMemberContext } from "./enrollment";

export type MemberContext = {
  member: { id: string; name: string | null; email: string | null; actorType: "human" | "agent"; provisional: boolean };
  personalHive: { id: string; name: string };
  organisations: Array<{ id: string; name: string; role: "member" | "admin"; joinedAt: string; joinPaused: boolean }>;
  selectedHiveId: string;
  justJoined: { teamId: string; teamName: string; via: "domain" | "phrase" | "invite" | "owner" } | null;
  consent: { personWide: boolean };
  context?: HiveContext;
};

export async function sessionMemberContext(memberId: string, sessionId: string) {
  const rows = await getSql()`SELECT team_id FROM web_sessions WHERE id = ${sessionId} AND member_id = ${memberId} AND expires_at > now()`;
  if (!rows[0]) return null;
  return await memberContext(memberId, rows[0].team_id ?? undefined) ?? personalMemberContext(memberId);
}

export async function signInMemberContext(memberId: string, sessionId?: string) {
  const sql = getSql();
  const people = await sql`SELECT actor_type, email_verified FROM members WHERE id = ${memberId}`;
  const pending = await sql`SELECT value FROM auth_verification WHERE id = ${`hive-enrollment-context:${memberId}`} AND expires_at > now()`;
  const choice = pending[0] ? JSON.parse(pending[0].value) : null;
  const selected = choice ? await memberContext(memberId, choice.teamId) : null;
  const enrolled = selected ?? (people[0]?.actor_type === "human" && people[0].email_verified ? await enrollMember(memberId) : await memberContext(memberId));
  const latest = sessionId ? await sql`DELETE FROM auth_verification WHERE id = ${`hive-enrollment-context:${memberId}`} AND expires_at > now() RETURNING value` : pending.length ? pending : await sql`SELECT value FROM auth_verification WHERE id = ${`hive-enrollment-context:${memberId}`} AND expires_at > now()`;
  if (latest[0] && sessionId && enrolled) {
    const joined = JSON.parse(latest[0].value);
    if (joined.joined && joined.teamId === enrolled.teamId) await sql`INSERT INTO auth_verification (id,identifier,value,expires_at) VALUES (${`hive-domain-landing:${sessionId}`},${`hive-domain-landing:${sessionId}`},${JSON.stringify({ teamId: enrolled.teamId, teamName: enrolled.teamName, via: joined.via, announce: true })},now()+interval '30 days') ON CONFLICT DO NOTHING`;
  }
  return enrolled;
}

export async function enrollSessionContext(memberId: string, sessionId: string) {
  const sql = getSql();
  const sessions = await sql`SELECT s.team_id, s.expires_at, m.actor_type, m.email_verified FROM web_sessions s JOIN members m ON m.id = s.member_id WHERE s.id = ${sessionId} AND s.member_id = ${memberId} AND s.expires_at > now() AND m.disabled_at IS NULL AND NOT m.provisional`;
  if (!sessions[0]) return null;
  const enrolled = sessions[0].actor_type === "human" && sessions[0].email_verified ? await enrollMember(memberId) : null;
  await sql.begin(async tx => {
    const selected = await tx`SELECT s.team_id, t.personal_owner_member_id FROM web_sessions s LEFT JOIN teams t ON t.id = s.team_id WHERE s.id = ${sessionId} AND s.member_id = ${memberId} AND s.expires_at > now() FOR UPDATE OF s`;
    if (!selected.length) return;
    const pending = await tx`DELETE FROM auth_verification WHERE id=${`hive-enrollment-context:${memberId}`} AND expires_at>now() RETURNING value`;
    const choice = pending[0] ? JSON.parse(pending[0].value) : null;
    const chosen = choice ? await memberContext(memberId, choice.teamId) : null;
    const target = chosen ?? enrolled;
    if (!target) return;
    const id = `hive-domain-landing:${sessionId}`;
    const prior = await tx`SELECT value FROM auth_verification WHERE id = ${id}`;
    if (prior.length && !chosen) return;
    const teams = await tx`SELECT personal_owner_member_id FROM teams WHERE id = ${target.teamId}`;
    if (!teams[0] || teams[0].personal_owner_member_id !== null) return;
    const switchHive = Boolean(chosen) || !selected[0].team_id || selected[0].personal_owner_member_id !== null;
    if (switchHive) await tx`UPDATE web_sessions SET team_id = ${target.teamId} WHERE id = ${sessionId}`;
    const announce = chosen ? Boolean(choice.joined) : switchHive;
    await tx`INSERT INTO auth_verification (id,identifier,value,expires_at) VALUES (${id},${id},${JSON.stringify({ teamId: target.teamId, teamName: target.teamName, via: chosen ? choice.via : "domain", announce })},${sessions[0].expires_at}) ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at`;
  });
  return sessionMemberContext(memberId, sessionId);
}

export const loadMemberContext = cache(async (memberId: string, sessionId: string): Promise<MemberContext | null> => {
  const context = await enrollSessionContext(memberId, sessionId);
  if (!context) return null;
  const sql = getSql();
  const person = (await sql`SELECT id,name,email,actor_type,provisional FROM members WHERE id=${memberId}`)[0];
  const personal = await personalMemberContext(memberId);
  if (!person || !personal) return null;
  const hives = await listHiveContexts(memberId);
  const rows = await sql`SELECT h.team_id,h.role,h.joined_at,t.join_paused FROM hive_memberships h JOIN teams t ON t.id=h.team_id WHERE h.member_id=${memberId} AND h.removed_at IS NULL AND t.personal_owner_member_id IS NULL`;
  const organisations = hives.filter(h => !h.personal).flatMap(h => {
    const row = rows.find(r => r.team_id === h.teamId);
    return row ? [{ id: h.teamId, name: h.teamName, role: row.role as "member" | "admin", joinedAt: row.joined_at.toISOString(), joinPaused: Boolean(row.join_paused) }] : [];
  });
  const justJoined = await sql.begin(async tx => {
    const id = `hive-domain-landing:${sessionId}`;
    const values = await tx`SELECT value FROM auth_verification WHERE id=${id} AND expires_at>now() FOR UPDATE`;
    if (!values[0]) return null;
    const value = JSON.parse(values[0].value);
    if (!value.announce || value.teamId !== context.teamId) return null;
    value.announce = false;
    await tx`UPDATE auth_verification SET value=${JSON.stringify(value)} WHERE id=${id}`;
    return { teamId: String(value.teamId), teamName: String(value.teamName), via: value.via as NonNullable<MemberContext["justJoined"]>["via"] };
  });
  const grants = await sql`SELECT id FROM auth_oauth_consent WHERE user_id=${memberId} AND reference_id=${personal.teamId} AND 'hive:person'=ANY(scopes) LIMIT 1`;
  return { member: { id: person.id, name: person.name, email: person.email, actorType: person.actor_type, provisional: person.provisional }, personalHive: { id: personal.teamId, name: personal.teamName }, organisations, selectedHiveId: context.teamId, justJoined, consent: { personWide: grants.length > 0 }, context };
});
