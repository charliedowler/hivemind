import {
  accessEvent,
  analyticsTransaction,
  recordMutation,
  withActor,
} from "../analytics/events";
import { withdrawPublication } from "../project-sharing";
import { scheduleKnowledge } from "../knowledge-tree";
import type { HiveContext } from "@hivemind/core";
import { lockLearningWrites } from "../lifecycle";
import { getSql } from "../db/client";
import { hashToken, newToken } from "../db/ids";
import { HiveError, HiveInputError, HiveNotFoundError } from "../errors";
import { emailDomain, isPublicDomain } from "./email-domain";
import { requireHuman } from "./agent-enrollment";
export async function requireAdmin(ctx: HiveContext): Promise<void> {
  await requireHuman(ctx.memberId);
  const rows =
    await getSql()`SELECT h.member_id FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.role = 'admin' AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional`;
  if (!rows.length)
    throw new HiveError("Only a team admin can do this.", 403);
}
export async function account(ctx: HiveContext) {
  const sql = getSql();
  const [members, keys] = await Promise.all([
    sql`SELECT m.name, m.email, m.email_verified, h.role FROM members m JOIN hive_memberships h ON h.member_id = m.id WHERE m.id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional`,
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
  await requireHuman(ctx.memberId);
  const rows =
    await getSql()`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId} AND (member_id = ${ctx.memberId} OR EXISTS (SELECT 1 FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.role = 'admin' AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional)) RETURNING id`;
  if (!rows.length) throw new HiveNotFoundError("Key not found in your team.");
  await accessEvent(ctx, "key_revoked", { keyId: id }, id);
}
export async function rotateInvite(ctx: HiveContext) {
  await requireAdmin(ctx);
  const inviteCode = `hive-${newToken()}`;
  const rows =
    await getSql()`UPDATE teams SET invite_code = ${hashToken(inviteCode)}, invite_expires_at = now() + interval '7 days' WHERE id = ${ctx.teamId} RETURNING invite_expires_at`;
  await accessEvent(ctx, "invite_rotated", { role: "admin" });
  return { inviteCode, expiresAt: rows[0].invite_expires_at.toISOString() };
}
export async function allowDomain(ctx: HiveContext): Promise<void> {
  await requireAdmin(ctx);
  const sql = getSql();
  const organisations = await sql`SELECT id FROM teams WHERE id = ${ctx.teamId} AND personal_owner_member_id IS NULL`;
  if (!organisations.length) throw new HiveInputError("Work domains belong to organisation hives.");
  const rows =
    await sql`SELECT m.email FROM members m JOIN hive_memberships h ON h.member_id = m.id WHERE m.id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND m.email_verified AND h.removed_at IS NULL AND m.disabled_at IS NULL`;
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
    await tx`SELECT id FROM members WHERE id IN (${ctx.memberId}, ${id}) ORDER BY id FOR UPDATE`;
    const admin = await tx`SELECT h.member_id FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.role = 'admin' AND h.removed_at IS NULL AND m.actor_type = 'human' AND NOT m.provisional AND m.disabled_at IS NULL FOR UPDATE OF h`;
    if (!admin.length) throw new HiveError("Only a team admin can do this.", 403);
    const teams = await tx`SELECT personal_owner_member_id FROM teams WHERE id = ${ctx.teamId}`;
    if (teams[0]?.personal_owner_member_id === id) throw new HiveInputError("A personal hive keeps its owner.");
    const rows = await tx`UPDATE hive_memberships SET removed_at = now() WHERE member_id = ${id} AND team_id = ${ctx.teamId} AND removed_at IS NULL RETURNING member_id`;
    if (!rows.length) throw new HiveNotFoundError("Member not found in your team.");
    const agents = await tx`UPDATE hive_memberships h SET removed_at = now() WHERE h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND h.member_id IN (SELECT b.agent_member_id FROM hive_agent_owners b WHERE b.owner_member_id = ${id}) RETURNING member_id`;
    const removed = [id, ...agents.map(row => String(row.member_id))];
    await tx`UPDATE api_keys SET revoked_at = now() WHERE member_id IN ${tx(removed)} AND team_id = ${ctx.teamId}`;
    await tx`DELETE FROM web_sessions WHERE member_id IN ${tx(removed)} AND team_id = ${ctx.teamId}`;
  });
  await accessEvent(
    ctx,
    "member_removed",
    { targetMemberId: id, role: "admin" },
    id,
  );
}
export async function moderateLearning(
  ctx: HiveContext,
  id: string,
  action: "delete" | "outdated",
): Promise<void> {
  await requireAdmin(ctx);
  const publications = await getSql()`SELECT learning_id FROM learning_shares WHERE learning_id = ${id} AND team_id = ${ctx.teamId} AND withdrawn_at IS NULL`;
  if (publications.length) {
    if (action === "delete") await withdrawPublication(ctx, id, ctx.teamId);
    else await getSql()`UPDATE learning_shares SET admin_outdated = true WHERE learning_id = ${id} AND team_id = ${ctx.teamId} AND withdrawn_at IS NULL`;
    scheduleKnowledge(ctx);
    return;
  }
  await withActor(ctx, () =>
    analyticsTransaction(() =>
      getSql().begin(async (tx) => {
        await lockLearningWrites(tx, ctx);
        const rows =
          await tx`SELECT id, lifecycle FROM learnings WHERE id = ${id} AND team_id = ${ctx.teamId} AND (NOT capture_flagged OR member_id = ${ctx.memberId}) FOR UPDATE`;
        if (!rows.length) throw new HiveNotFoundError();
        if (rows[0].lifecycle === "superseded")
          throw new HiveError(
            "Moderate the current cell in the chain instead.",
            409,
          );
        await tx`UPDATE learnings SET lifecycle = ${action === "delete" ? "retracted" : "outdated"}, admin_outdated = true, updated_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId}`;
        const state = action === "delete" ? "retracted" : "outdated";
        if (rows[0].lifecycle !== state)
          await recordMutation({
            name: "learning.lifecycle_changed",
            learningId: id,
            reasonCode: "manual",
            properties: { previousState: rows[0].lifecycle, state },
          });
      }),
    ),
  );
  scheduleKnowledge(ctx);
}

export async function revokeJoinCapability(ctx: HiveContext, capability: string): Promise<void> {
  await requireHuman(ctx.memberId);
  await getSql().begin(async tx => {
    await tx`SELECT id FROM members WHERE id = ${ctx.memberId} FOR UPDATE`;
    await tx`UPDATE hive_join_capabilities SET revoked_at = now() WHERE token_hash = ${hashToken(capability)} AND owner_member_id = ${ctx.memberId}`;
  });
}
