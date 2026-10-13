import type postgres from "postgres";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { HiveError } from "../errors";
import { requireAdmin } from "./access";
import { emailDomain, isPublicDomain } from "./email-domain";
import { withHumanJoinPhrase } from "./join-phrases";
import { followOwnerMemberships } from "./owner-bindings";
import { recordMembershipJoin } from "./join-receipts";
import { deliverEmail } from "./email";
import { notifyJoinRequestAdmins } from "../slack/join-request-notifications";

export type JoinRequestView = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};
export type JoinDecision = "approve" | "decline";
const unavailable = () =>
  new HiveError(
    "This request is no longer pending. Refresh the Team page.",
    409,
  );

async function expireForTeam(tx: postgres.TransactionSql, teamId: string) {
  await tx`UPDATE hive_join_requests SET status='expired' WHERE team_id=${teamId} AND status='pending' AND expires_at<=now()`;
}
async function lockTeam(tx: postgres.TransactionSql, ctx: HiveContext) {
  const admins =
    await tx`SELECT t.id FROM teams t JOIN hive_memberships h ON h.team_id=t.id JOIN members m ON m.id=h.member_id WHERE t.id=${ctx.teamId} AND t.personal_owner_member_id IS NULL AND m.id=${ctx.memberId} AND h.role='admin' AND h.removed_at IS NULL AND m.actor_type='human' AND m.email_verified AND NOT m.provisional AND m.disabled_at IS NULL FOR UPDATE OF t FOR SHARE OF h,m`;
  if (!admins.length)
    throw new HiveError("Only a team admin can do this.", 403);
  await expireForTeam(tx, ctx.teamId);
}

export async function joinRequestLanding(
  ctx: HiveContext,
  phrase: string,
  trustedProxyIp: string | null,
) {
  return withHumanJoinPhrase(
    ctx,
    phrase,
    trustedProxyIp,
    async (tx, team, human) => {
      const [domains, membership, requests] = await Promise.all([
        tx`SELECT domain FROM team_domains WHERE team_id=${team.id} ORDER BY domain`,
        tx`SELECT member_id FROM hive_memberships WHERE team_id=${team.id} AND member_id=${human.id} AND removed_at IS NULL`,
        tx`SELECT status,expires_at,decided_at FROM hive_join_requests WHERE team_id=${team.id} AND member_id=${human.id} ORDER BY created_at DESC,id DESC LIMIT 1`,
      ]);
      const domain = emailDomain(String(human.email));
      const automatic = Boolean(
        domain &&
        !isPublicDomain(domain) &&
        domains.some((row) => row.domain === domain),
      );
      const latest = requests[0];
      const requestStatus =
        latest?.status === "pending" &&
        new Date(latest.expires_at).getTime() <= Date.now()
          ? "expired"
          : (latest?.status ?? null);
      const retryAt =
        requestStatus === "declined"
          ? new Date(
              new Date(latest!.decided_at).getTime() + 7 * 86400000,
            ).toISOString()
          : null;
      const counts =
        await tx`SELECT count(*)::int AS count FROM project_sharing_grants WHERE owner_member_id=${human.id} AND team_id=${team.id} AND withdrawn_at IS NULL`;
      return {
        teamId: String(team.id),
        teamName: String(team.name),
        domains: domains.map((row) => String(row.domain)),
        automatic,
        joined: membership.length > 0,
        requestStatus,
        retryAt,
        sharedProjects: Number(counts[0].count),
      };
    },
  );
}

export async function joinOrRequest(
  ctx: HiveContext,
  phrase: string,
  trustedProxyIp: string | null,
) {
  const result = await withHumanJoinPhrase(
    ctx,
    phrase,
    trustedProxyIp,
    async (tx, team, human) => {
      await expireForTeam(tx, String(team.id));
      const active =
        await tx`SELECT member_id FROM hive_memberships WHERE member_id=${human.id} AND team_id=${team.id} AND removed_at IS NULL`;
      const domain = emailDomain(String(human.email));
      const domains =
        await tx`SELECT domain FROM team_domains WHERE team_id=${team.id} AND domain=${domain ?? ""} FOR SHARE`;
      if (
        active.length ||
        (domain && !isPublicDomain(domain) && domains.length)
      ) {
        const added =
          await tx`INSERT INTO hive_memberships (member_id,team_id,role) VALUES (${human.id},${team.id},'member') ON CONFLICT DO NOTHING RETURNING member_id`;
        if (added.length)
          await recordMembershipJoin(
            tx,
            String(human.id),
            String(team.id),
            "phrase",
          );
        await followOwnerMemberships(tx, String(human.id));
        return {
          status: "joined" as const,
          teamId: String(team.id),
          teamName: String(team.name),
        };
      }
      const pending =
        await tx`SELECT id FROM hive_join_requests WHERE team_id=${team.id} AND member_id=${human.id} AND status='pending' FOR UPDATE`;
      if (pending[0])
        return {
          status: "requested" as const,
          requestId: String(pending[0].id),
        };
      const declined =
        await tx`SELECT id FROM hive_join_requests WHERE team_id=${team.id} AND email=${String(human.email).toLowerCase()} AND status='declined' AND decided_at>now()-interval '7 days'`;
      if (declined.length)
        throw new HiveError(
          "Your request was declined. You can ask again seven days after that decision.",
          429,
        );
      const id = newId("jrq");
      await tx`INSERT INTO hive_join_requests(id,team_id,member_id,email,phrase_generation) VALUES (${id},${team.id},${human.id},${String(human.email).toLowerCase()},${team.join_generation})`;
      await tx`INSERT INTO hive_join_request_notifications(request_id,admin_member_id) SELECT ${id},h.member_id FROM hive_memberships h JOIN members m ON m.id=h.member_id WHERE h.team_id=${team.id} AND h.role='admin' AND h.removed_at IS NULL AND m.actor_type='human' AND m.email_verified AND NOT m.provisional AND m.disabled_at IS NULL ON CONFLICT DO NOTHING`;
      return { status: "requested" as const, requestId: id };
    },
  );
  if (result.status === "requested")
    await notifyJoinRequestAdmins(result.requestId);
  return result;
}

export async function listJoinRequests(
  ctx: HiveContext,
): Promise<JoinRequestView[]> {
  await requireAdmin(ctx);
  const rows =
    await getSql()`SELECT r.id,m.name,r.email,r.created_at FROM hive_join_requests r JOIN members m ON m.id=r.member_id WHERE r.team_id=${ctx.teamId} AND r.status='pending' AND r.expires_at>now() AND m.disabled_at IS NULL AND m.email_verified AND NOT m.provisional ORDER BY r.created_at,r.id`;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function decideJoinRequestInTransaction(
  tx: postgres.TransactionSql,
  ctx: HiveContext,
  id: string,
  decision: JoinDecision,
) {
  await tx`SELECT m.id FROM members m WHERE m.id IN (${ctx.memberId},(SELECT member_id FROM hive_join_requests WHERE id=${id} AND team_id=${ctx.teamId})) ORDER BY m.id FOR UPDATE`;
  await lockTeam(tx, ctx);
  const requests =
    await tx`SELECT * FROM hive_join_requests WHERE id=${id} AND team_id=${ctx.teamId} FOR UPDATE`;
  const request = requests[0];
  if (
    !request ||
    request.status !== "pending" ||
    new Date(request.expires_at).getTime() <= Date.now()
  )
    throw unavailable();
  const humans =
    await tx`SELECT id FROM members WHERE id=${request.member_id} AND actor_type='human' AND email_verified AND NOT provisional AND disabled_at IS NULL AND lower(email)=${request.email} FOR UPDATE`;
  if (!humans.length) throw unavailable();
  let created = false;
  let joinedAt: Date | null = null;
  if (decision === "approve") {
    const prior =
      await tx`SELECT * FROM hive_memberships WHERE member_id=${request.member_id} AND team_id=${ctx.teamId} FOR UPDATE`;
    if (prior[0]?.removed_at && !request.undone_at)
      throw new HiveError(
        "This person's membership was removed. Review it before approving.",
        409,
      );
    const added =
      await tx`INSERT INTO hive_memberships(member_id,team_id,role) VALUES (${request.member_id},${ctx.teamId},'member') ON CONFLICT (member_id,team_id) DO UPDATE SET removed_at=NULL,joined_at=now(),role='member' WHERE hive_memberships.removed_at IS NOT NULL RETURNING joined_at`;
    created = added.length > 0;
    joinedAt = added[0]?.joined_at ?? null;
    if (request.undone_at)
      await tx`UPDATE hive_memberships SET removed_at=NULL,joined_at=now() WHERE team_id=${ctx.teamId} AND owner_member_id=${request.member_id} AND removed_at=${request.undone_at}`;
    await followOwnerMemberships(tx, String(request.member_id));
    await recordMembershipJoin(
      tx,
      String(request.member_id),
      ctx.teamId,
      "invite",
      created,
    );
  }
  const rows =
    await tx`UPDATE hive_join_requests SET status=${decision === "approve" ? "approved" : "declined"},decided_by=${ctx.memberId},decided_at=now(),undone_at=NULL,undo_action_id=NULL,membership_created=${created},approved_joined_at=${joinedAt} WHERE id=${id} RETURNING decided_at::text AS version`;
  return { id, version: String(rows[0].version), decision };
}

export async function decideJoinRequest(
  ctx: HiveContext,
  id: string,
  decision: JoinDecision,
) {
  await requireAdmin(ctx);
  const result = await getSql().begin((tx) =>
    decideJoinRequestInTransaction(tx, ctx, id, decision),
  );
  if (decision === "decline") await deliverJoinDecline(id);
  return result;
}

export async function deliverJoinDecline(id: string) {
  return getSql().begin(async (tx) => {
    const rows =
      await tx`SELECT r.email,t.name FROM hive_join_requests r JOIN teams t ON t.id=r.team_id WHERE r.id=${id} AND r.status='declined' AND r.decline_emailed_at IS NULL FOR UPDATE OF r`;
    if (!rows[0]) return;
    if (
      await deliverEmail(
        String(rows[0].email),
        "Your Hive join request",
        `Your request to join ${rows[0].name} was declined.`,
        `hive-join-declined/${id}`,
      )
    )
      await tx`UPDATE hive_join_requests SET decline_emailed_at=now() WHERE id=${id}`;
  });
}

export async function undoJoinRequest(
  tx: postgres.TransactionSql,
  ctx: HiveContext,
  id: string,
  version: string,
) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${ctx.teamId}),7291)`;
  await tx`SELECT m.id FROM members m WHERE m.id IN (${ctx.memberId},(SELECT member_id FROM hive_join_requests WHERE id=${id} AND team_id=${ctx.teamId})) ORDER BY m.id FOR UPDATE`;
  await lockTeam(tx, ctx);
  const rows =
    await tx`SELECT *,decided_at::text AS version FROM hive_join_requests WHERE id=${id} AND team_id=${ctx.teamId} FOR UPDATE`;
  const request = rows[0];
  if (
    !request ||
    request.version !== version ||
    request.decided_by !== ctx.memberId ||
    !["approved", "declined"].includes(request.status)
  )
    throw new HiveError("This request changed after your decision.", 409);
  if (new Date(request.decided_at).getTime() + 3600000 <= Date.now())
    throw new HiveError("The one-hour undo window has ended.", 409);
  if (request.status === "approved" && request.membership_created) {
    const members =
      await tx`SELECT member_id,role,joined_at FROM hive_memberships WHERE team_id=${ctx.teamId} AND (member_id=${request.member_id} OR owner_member_id=${request.member_id}) AND removed_at IS NULL FOR UPDATE`;
    const human = members.find((row) => row.member_id === request.member_id);
    if (
      !human ||
      human.role !== "member" ||
      new Date(human.joined_at).getTime() !==
        new Date(request.approved_joined_at).getTime()
    )
      throw new HiveError("This membership changed after your approval.", 409);
    const ids = members.map((row) => String(row.member_id));
    const captured =
      await tx`SELECT id FROM learnings WHERE team_id=${ctx.teamId} AND (owner_member_id=${request.member_id} OR member_id=ANY(${ids}::text[])) UNION ALL SELECT learning_id AS id FROM learning_shares WHERE team_id=${ctx.teamId} AND owner_member_id=${request.member_id} UNION ALL SELECT id FROM learning_pushes WHERE team_id=${ctx.teamId} AND member_id=ANY(${ids}::text[]) LIMIT 1`;
    if (captured.length)
      throw new HiveError(
        "They have already captured into this hive, so approval cannot be undone.",
        409,
      );
    const stamp = (await tx`SELECT now() AS at`)[0].at;
    await tx`UPDATE hive_memberships SET removed_at=${stamp} WHERE team_id=${ctx.teamId} AND member_id=ANY(${ids}::text[])`;
    await tx`UPDATE api_keys SET revoked_at=now() WHERE team_id=${ctx.teamId} AND member_id=ANY(${ids}::text[]) AND revoked_at IS NULL`;
    await tx`DELETE FROM web_sessions WHERE team_id=${ctx.teamId} AND member_id=ANY(${ids}::text[])`;
    await tx`UPDATE hive_join_requests SET undone_at=${stamp} WHERE id=${id}`;
  } else await tx`UPDATE hive_join_requests SET undone_at=now() WHERE id=${id}`;
  await tx`UPDATE hive_join_requests SET status=CASE WHEN expires_at>now() THEN 'pending' ELSE 'expired' END,decided_by=NULL,decided_at=NULL,membership_created=false,approved_joined_at=NULL WHERE id=${id}`;
}

export async function maintainJoinRequests() {
  const sql = getSql();
  const [expired, pending, declined] = await Promise.all([
    sql`UPDATE hive_join_requests SET status='expired' WHERE status='pending' AND expires_at<=now() RETURNING id`,
    sql`SELECT DISTINCT r.id FROM hive_join_requests r JOIN hive_join_request_notifications n ON n.request_id=r.id WHERE r.status='pending' AND r.expires_at>now() AND n.status='pending' ORDER BY r.id LIMIT 25`,
    sql`SELECT id FROM hive_join_requests WHERE status='declined' AND decline_emailed_at IS NULL ORDER BY decided_at,id LIMIT 25`,
  ]);
  async function deliverBatch(index: number): Promise<void> {
    if (index >= Math.max(pending.length, declined.length)) return;
    await Promise.all([
      pending[index]
        ? notifyJoinRequestAdmins(String(pending[index].id))
        : Promise.resolve(),
      declined[index]
        ? deliverJoinDecline(String(declined[index].id))
        : Promise.resolve(),
    ]);
    await deliverBatch(index + 1);
  }
  await deliverBatch(0);
  return { expired: expired.length };
}
