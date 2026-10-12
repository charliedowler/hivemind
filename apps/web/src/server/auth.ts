import {
  createTeamInput,
  joinTeamInput,
  type CreateTeamInput,
  type HiveContext,
  type JoinTeamInput,
} from "@hivemind/core";
import { cookies } from "next/headers";
import { getSql } from "./db/client";
import { hashToken, newId, newToken, randomBase32 } from "./db/ids";
import { HiveInputError, HiveNotFoundError } from "./errors";

function context(row: Record<string, unknown>): HiveContext {
  return {
    teamId: String(row.team_id),
    teamName: String(row.team_name),
    memberId: String(row.member_id),
    memberName: String(row.member_name),
  };
}

export async function createTeam(
  input: CreateTeamInput,
): Promise<{ ctx: HiveContext; apiKey: string; inviteCode: string }> {
  const parsed = createTeamInput.safeParse(input);
  if (!parsed.success)
    throw new HiveInputError(
      "Enter a team name and your name, each up to 80 characters.",
    );
  const ctx = {
    teamId: newId("team"),
    teamName: parsed.data.teamName,
    memberId: newId("mem"),
    memberName: parsed.data.memberName,
  };
  const inviteCode = `hive-${randomBase32(10)}`;
  const apiKey = `hm_${newToken()}`;
  await getSql().begin(async (tx) => {
    await tx`INSERT INTO teams (id, name, invite_code) VALUES (${ctx.teamId}, ${ctx.teamName}, ${inviteCode})`;
    await tx`INSERT INTO members (id, team_id, name) VALUES (${ctx.memberId}, ${ctx.teamId}, ${ctx.memberName})`;
    await tx`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix) VALUES (${newId("key")}, ${ctx.teamId}, ${ctx.memberId}, ${hashToken(apiKey)}, ${apiKey.slice(0, 10)})`;
  });
  return { ctx, apiKey, inviteCode };
}

export async function joinTeam(
  input: JoinTeamInput,
): Promise<{ ctx: HiveContext; apiKey: string } | null> {
  const parsed = joinTeamInput.safeParse(input);
  if (!parsed.success)
    throw new HiveInputError(
      "Enter an invite code and your name, up to 80 characters.",
    );
  const sql = getSql();
  const teams =
    await sql`SELECT id, name FROM teams WHERE invite_code = ${parsed.data.inviteCode}`;
  if (!teams[0]) return null;
  const ctx: HiveContext = {
    teamId: teams[0].id,
    teamName: teams[0].name,
    memberId: newId("mem"),
    memberName: parsed.data.memberName,
  };
  const apiKey = `hm_${newToken()}`;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO members (id, team_id, name) VALUES (${ctx.memberId}, ${ctx.teamId}, ${ctx.memberName})`;
    await tx`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix) VALUES (${newId("key")}, ${ctx.teamId}, ${ctx.memberId}, ${hashToken(apiKey)}, ${apiKey.slice(0, 10)})`;
  });
  return { ctx, apiKey };
}

export async function authenticateApiKey(
  rawKey: string,
): Promise<HiveContext | null> {
  if (!/^hm_[A-Za-z0-9_-]{43}$/.test(rawKey)) return null;
  const sql = getSql();
  const rows =
    await sql`SELECT k.id, k.team_id, t.name AS team_name, k.member_id, m.name AS member_name FROM api_keys k JOIN teams t ON t.id = k.team_id JOIN members m ON m.id = k.member_id AND m.team_id = k.team_id WHERE k.key_hash = ${hashToken(rawKey)} AND k.revoked_at IS NULL`;
  if (!rows[0]) return null;
  const ctx = context(rows[0]);
  await sql`WITH touched AS (UPDATE api_keys SET last_used_at = now() WHERE id = ${rows[0].id} AND team_id = ${ctx.teamId} AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at <= now() - interval '1 minute') RETURNING member_id) UPDATE members SET last_seen_at = now() WHERE id IN (SELECT member_id FROM touched) AND team_id = ${ctx.teamId}`;
  return ctx;
}

export async function issueApiKey(
  ctx: HiveContext,
  label?: string,
): Promise<{ apiKey: string; prefix: string }> {
  const apiKey = `hm_${newToken()}`;
  const prefix = apiKey.slice(0, 10);
  const rows =
    await getSql()`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix, label) SELECT ${newId("key")}, ${ctx.teamId}, id, ${hashToken(apiKey)}, ${prefix}, ${label?.trim().slice(0, 120) || "Agent key"} FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} RETURNING id`;
  if (!rows.length)
    throw new HiveNotFoundError("Member not found in your team.");
  return { apiKey, prefix };
}

export async function startWebSession(ctx: HiveContext): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + 30 * 86400000);
  const rows =
    await getSql()`INSERT INTO web_sessions (id, member_id, team_id, token_hash, expires_at) SELECT ${newId("ses")}, id, ${ctx.teamId}, ${hashToken(token)}, ${expires} FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} RETURNING id`;
  if (!rows.length)
    throw new HiveNotFoundError("Member not found in your team.");
  (await cookies()).set("hm_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires,
    path: "/",
  });
}

export async function getWebContext(): Promise<HiveContext | null> {
  const token = (await cookies()).get("hm_session")?.value;
  if (!token) return null;
  const rows =
    await getSql()`SELECT s.team_id, t.name AS team_name, s.member_id, m.name AS member_name FROM web_sessions s JOIN teams t ON t.id = s.team_id JOIN members m ON m.id = s.member_id AND m.team_id = s.team_id WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()`;
  return rows[0] ? context(rows[0]) : null;
}

export async function endWebSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get("hm_session")?.value;
  if (token) {
    const ctx = await getWebContext();
    if (ctx)
      await getSql()`DELETE FROM web_sessions WHERE token_hash = ${hashToken(token)} AND team_id = ${ctx.teamId} AND member_id = ${ctx.memberId}`;
  }
  jar.delete("hm_session");
}
