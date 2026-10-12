import { scheduleKnowledge } from "../knowledge-tree";
import type { HiveContext } from "@hivemind/core";
import { lockLearningWrites } from "../lifecycle";
import { getSql } from "../db/client";
import { hashToken, newToken } from "../db/ids";
import { HiveError, HiveInputError, HiveNotFoundError } from "../errors";
import { emailDomain, isPublicDomain } from "./email-domain";
export async function requireAdmin(ctx: HiveContext): Promise<void> {
  const rows =
    await getSql()`SELECT id FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND role = 'admin' AND removed_at IS NULL`;
  if (!rows.length)
    throw new HiveError("A team admin is needed for this action.", 403);
}
export async function account(ctx: HiveContext) {
  const sql = getSql();
  const [members, keys] = await Promise.all([
    sql`SELECT name, email, email_verified, role FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND removed_at IS NULL`,
    sql`SELECT id, prefix, label, created_at, last_used_at, revoked_at FROM api_keys WHERE team_id = ${ctx.teamId} AND member_id = ${ctx.memberId} ORDER BY created_at DESC`,
  ]);
  if (!members[0]) throw new HiveNotFoundError("Member not found.");
  return {
    member: {
      name: String(members[0].name),
      email: members[0].email as string | null,
      email_verified: Boolean(members[0].email_verified),
      role: String(members[0].role),
    },
    keys: keys.map((key) => ({
      id: String(key.id),
      prefix: String(key.prefix),
      label: String(key.label),
      created_at: key.created_at.toISOString(),
      last_used_at: key.last_used_at?.toISOString() ?? null,
      revoked_at: key.revoked_at?.toISOString() ?? null,
    })),
  };
}
export async function revokeKey(ctx: HiveContext, id: string): Promise<void> {
  const rows =
    await getSql()`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId} AND (member_id = ${ctx.memberId} OR EXISTS (SELECT 1 FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND role = 'admin' AND removed_at IS NULL)) RETURNING id`;
  if (!rows.length) throw new HiveNotFoundError("Key not found in your team.");
}
export async function rotateInvite(ctx: HiveContext) {
  await requireAdmin(ctx);
  const inviteCode = `hive-${newToken()}`;
  const rows =
    await getSql()`UPDATE teams SET invite_code = ${hashToken(inviteCode)}, invite_expires_at = now() + interval '7 days' WHERE id = ${ctx.teamId} RETURNING invite_expires_at`;
  return { inviteCode, expiresAt: rows[0].invite_expires_at.toISOString() };
}
export async function allowDomain(ctx: HiveContext): Promise<void> {
  await requireAdmin(ctx);
  const sql = getSql();
  const rows =
    await sql`SELECT email FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND email_verified = true AND removed_at IS NULL`;
  const domain = rows[0] && emailDomain(rows[0].email);
  if (!domain || isPublicDomain(domain))
    throw new HiveInputError(
      "Verify your work email before allowing its domain. Public email domains cannot join a hive.",
    );
  const inserted =
    await sql`INSERT INTO team_domains (team_id, domain, created_by) VALUES (${ctx.teamId}, ${domain}, ${ctx.memberId}) ON CONFLICT (domain) DO NOTHING RETURNING domain`;
  if (
    !inserted.length &&
    !(
      await sql`SELECT domain FROM team_domains WHERE team_id = ${ctx.teamId} AND domain = ${domain}`
    ).length
  )
    throw new HiveInputError("This domain already belongs to a hive.");
}
export async function removeMember(
  ctx: HiveContext,
  id: string,
): Promise<void> {
  await requireAdmin(ctx);
  if (id === ctx.memberId)
    throw new HiveInputError("You cannot remove your own membership.");
  await getSql().begin(async (tx) => {
    const rows =
      await tx`UPDATE members SET removed_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId} AND removed_at IS NULL RETURNING id`;
    if (!rows.length)
      throw new HiveNotFoundError("Member not found in your team.");
    await tx`UPDATE api_keys SET revoked_at = now() WHERE member_id = ${id} AND team_id = ${ctx.teamId}`;
    await tx`DELETE FROM web_sessions WHERE member_id = ${id} AND team_id = ${ctx.teamId}`;
  });
}
export async function moderateLearning(ctx: HiveContext, id: string, action: "delete" | "outdated"): Promise<void> {
  await requireAdmin(ctx);
  await getSql().begin(async (tx) => {
    await lockLearningWrites(tx, ctx);
    const rows = await tx`SELECT id, lifecycle FROM learnings WHERE id = ${id} AND team_id = ${ctx.teamId} FOR UPDATE`;
    if (!rows.length) throw new HiveNotFoundError();
    if (rows[0].lifecycle === "superseded") throw new HiveError("Moderate the current cell in the chain instead.", 409);
    await tx`UPDATE learnings SET lifecycle = ${action === "delete" ? "retracted" : "outdated"}, admin_outdated = true, updated_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId}`;
  });
  scheduleKnowledge(ctx);
}
