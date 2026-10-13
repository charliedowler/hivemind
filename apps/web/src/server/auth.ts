import {
  accessEvent,
  bindApiKey,
  bindRole,
  withActor,
} from "./analytics/events";
import {
  createTeamInput,
  joinTeamInput,
  type CreateTeamInput,
  type HiveContext,
  type JoinTeamInput,
} from "@hivemind/core";
import { cookies, headers } from "next/headers";
import { getSql } from "./db/client";
import { hashToken, newId, newToken, randomBase32 } from "./db/ids";
import { HiveInputError, HiveNotFoundError } from "./errors";
import { memberContext } from "./identity/enrollment";
import { requireHuman } from "./identity/agent-enrollment";
import { loadMemberContext, type MemberContext } from "./identity/session-context";

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
  const keyId = newId("key");
  await getSql().begin(async (tx) => {
    await tx`INSERT INTO teams (id, name, invite_code) VALUES (${ctx.teamId}, ${ctx.teamName}, ${hashToken(inviteCode)})`;
    await tx`INSERT INTO members (id, name) VALUES (${ctx.memberId}, ${ctx.memberName})`;
    await tx`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${ctx.memberId}, ${ctx.teamId}, 'admin')`;
    await tx`SELECT hive_ensure_personal_hive(${ctx.memberId})`;
    await tx`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix) VALUES (${keyId}, ${ctx.teamId}, ${ctx.memberId}, ${hashToken(apiKey)}, ${apiKey.slice(0, 10)})`;
  });
  bindApiKey(bindRole(ctx, "admin"), keyId);
  await withActor(ctx, async () => {
    await accessEvent(ctx, "signup");
    await accessEvent(ctx, "invite_created");
    await accessEvent(ctx, "key_created", { keyId }, keyId);
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
    await sql`SELECT id, name FROM teams WHERE invite_code = ${hashToken(parsed.data.inviteCode)} AND invite_expires_at > now()`;
  if (!teams[0]) return null;
  const ctx: HiveContext = {
    teamId: teams[0].id,
    teamName: teams[0].name,
    memberId: newId("mem"),
    memberName: parsed.data.memberName,
  };
  const apiKey = `hm_${newToken()}`;
  const keyId = newId("key");
  await sql.begin(async (tx) => {
    await tx`INSERT INTO members (id, name) VALUES (${ctx.memberId}, ${ctx.memberName})`;
    await tx`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${ctx.memberId}, ${ctx.teamId}, 'member')`;
    await tx`SELECT hive_ensure_personal_hive(${ctx.memberId})`;
    await tx`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix) VALUES (${keyId}, ${ctx.teamId}, ${ctx.memberId}, ${hashToken(apiKey)}, ${apiKey.slice(0, 10)})`;
  });
  bindApiKey(bindRole(ctx, "member"), keyId);
  await withActor(ctx, async () => {
    await accessEvent(ctx, "signup");
    await accessEvent(ctx, "invite_accepted");
    await accessEvent(ctx, "key_created", { keyId }, keyId);
  });
  return { ctx, apiKey };
}

export async function authenticateApiKey(
  rawKey: string,
): Promise<HiveContext | null> {
  if (!/^hm_[A-Za-z0-9_-]{43}$/.test(rawKey)) return null;
  const sql = getSql();
  const rows =
    await sql`SELECT k.id, k.team_id, t.name AS team_name, k.member_id, m.name AS member_name, h.role FROM api_keys k JOIN teams t ON t.id = k.team_id JOIN members m ON m.id = k.member_id JOIN hive_memberships h ON h.member_id = k.member_id AND h.team_id = k.team_id WHERE k.key_hash = ${hashToken(rawKey)} AND k.revoked_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional AND h.removed_at IS NULL`;
  if (!rows[0]) return null;
  const membership = await memberContext(rows[0].member_id, rows[0].team_id);
  if (!membership) return null;
  const ctx = bindApiKey(bindRole(membership, rows[0].role), rows[0].id);
  await sql`WITH touched AS (UPDATE api_keys SET last_used_at = now() WHERE id = ${rows[0].id} AND team_id = ${ctx.teamId} AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at <= now() - interval '1 minute') RETURNING member_id) UPDATE members SET last_seen_at = now() WHERE id IN (SELECT member_id FROM touched)`;
  return ctx;
}

export async function issueApiKey(
  ctx: HiveContext,
  label?: string,
): Promise<{ apiKey: string; prefix: string }> {
  await requireHuman(ctx.memberId);
  const apiKey = `hm_${newToken()}`;
  const prefix = apiKey.slice(0, 10);
  const rows =
    await getSql()`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix, label) SELECT ${newId("key")}, ${ctx.teamId}, id, ${hashToken(apiKey)}, ${prefix}, ${label?.trim().slice(0, 120) || "Agent key"} FROM members WHERE id = ${ctx.memberId} AND disabled_at IS NULL AND NOT provisional AND EXISTS (SELECT 1 FROM hive_memberships WHERE member_id = members.id AND team_id = ${ctx.teamId} AND removed_at IS NULL) RETURNING id`;
  if (!rows.length)
    throw new HiveNotFoundError("Member not found in your team.");
  await accessEvent(ctx, "key_created", { keyId: rows[0].id }, rows[0].id);
  return { apiKey, prefix };
}

export async function startWebSession(ctx: HiveContext): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + 30 * 86400000);
  const rows =
    await getSql()`INSERT INTO web_sessions (id, member_id, team_id, token_hash, expires_at) SELECT ${newId("ses")}, id, ${ctx.teamId}, ${hashToken(token)}, ${expires} FROM members WHERE id = ${ctx.memberId} AND disabled_at IS NULL AND NOT provisional AND EXISTS (SELECT 1 FROM hive_memberships WHERE member_id = members.id AND team_id = ${ctx.teamId} AND removed_at IS NULL) RETURNING id`;
  if (!rows.length)
    throw new HiveNotFoundError("Member not found in your team.");
  (await cookies()).set("hm_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires,
    path: "/",
  });
  await accessEvent(ctx, "login");
}

export async function getWebContext(): Promise<(HiveContext & { justJoined?: MemberContext["justJoined"] }) | null> {
  const jar = await cookies();
  if (jar.get("better-auth.session_token") || jar.get("__Secure-better-auth.session_token")) {
    const { getAuth } = await import("./better-auth");
    const session = await (await getAuth()).api.getSession({ headers: await headers() });
    if (!session?.user.emailVerified) return null;
    const loaded = await loadMemberContext(session.user.id, session.session.id);
    return loaded?.context ? Object.assign(loaded.context, loaded.justJoined ? { justJoined: loaded.justJoined } : {}) : null;
  }
  const token = jar.get("hm_session")?.value;
  if (!token) return null;
  const rows =
    await getSql()`SELECT s.id, s.member_id FROM web_sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND m.disabled_at IS NULL AND NOT m.provisional`;
  const loaded = rows[0] ? await loadMemberContext(rows[0].member_id, rows[0].id) : null;
  return loaded?.context ? Object.assign(loaded.context, loaded.justJoined ? { justJoined: loaded.justJoined } : {}) : null;
}

export async function endWebSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get("hm_session")?.value;
  if (token) {
    const ctx = await getWebContext();
    if (ctx) {
      await getSql()`DELETE FROM web_sessions WHERE token_hash = ${hashToken(token)} AND team_id = ${ctx.teamId} AND member_id = ${ctx.memberId}`;
      await accessEvent(ctx, "logout");
    }
  }
  jar.delete("hm_session");
}
