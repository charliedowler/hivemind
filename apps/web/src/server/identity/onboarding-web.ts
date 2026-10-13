import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { hashToken, newToken } from "../db/ids";
import { HiveError } from "../errors";
import { emailDomain, isPublicDomain } from "./email-domain";
import { listHiveContexts } from "./enrollment";
import { followOwnerMemberships } from "./owner-bindings";
import { recordMembershipJoin } from "./join-receipts";
import {
  randomJoinPhrase,
  lookupJoinPhrase,
  joinByPhrase,
} from "./join-phrases";
import { ownerCapturePolicy, publishProject } from "../project-sharing";

export { joinFailure } from "@/lib/onboarding-copy";

export async function humanActor(ctx: HiveContext) {
  const rows =
    await getSql()`SELECT m.id, m.name, m.email, m.email_verified FROM members m JOIN hive_memberships h ON h.member_id = m.id WHERE m.id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.actor_type = 'human' AND m.email_verified AND NOT m.provisional AND m.disabled_at IS NULL`;
  if (!rows[0])
    throw new HiveError("Sign in with your own account to do this.", 403);
  return rows[0];
}

export async function hiveChoices(ctx: HiveContext) {
  const hives = await listHiveContexts(ctx.memberId);
  return hives.map((hive) => ({
    teamId: hive.teamId,
    teamName: hive.teamName,
    personal: hive.personal,
  }));
}

export async function joinLanding(
  ctx: HiveContext,
  phrase: string,
  trustedProxyIp: string | null,
) {
  await humanActor(ctx);
  const team = await lookupJoinPhrase(ctx, phrase, { trustedProxyIp });
  const rows =
    await getSql()`SELECT count(*)::int AS count FROM project_sharing_grants WHERE owner_member_id = ${ctx.memberId} AND team_id = ${team.teamId} AND withdrawn_at IS NULL`;
  return { ...team, sharedProjects: Number(rows[0].count) };
}

export async function joinOrganisation(
  ctx: HiveContext,
  phrase: string,
  trustedProxyIp: string | null,
) {
  await humanActor(ctx);
  return joinByPhrase(ctx, phrase, { trustedProxyIp });
}

export async function createOrganisation(ctx: HiveContext, requestKey: string) {
  await humanActor(ctx);
  const teamId = `team_${hashToken(`organisation:${ctx.memberId}:${requestKey}`).slice(0, 32)}`;
  return getSql().begin(async (tx) => {
    const actors =
      await tx`SELECT m.id, m.name, m.email FROM members m JOIN hive_memberships h ON h.member_id = m.id WHERE m.id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.actor_type = 'human' AND m.email_verified AND NOT m.provisional AND m.disabled_at IS NULL FOR UPDATE OF m`;
    if (!actors[0])
      throw new HiveError("Sign in with your own account to do this.", 403);
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`create-organisation:${teamId}`}, 0))`;
    const prior =
      await tx`SELECT t.name, t.join_paused FROM teams t JOIN hive_memberships h ON h.team_id = t.id WHERE t.id = ${teamId} AND h.member_id = ${ctx.memberId} AND h.role = 'admin' AND h.removed_at IS NULL`;
    if (prior[0])
      return {
        teamId,
        teamName: String(prior[0].name),
        paused: Boolean(prior[0].join_paused),
      };
    const bucket = `create-organisation:${hashToken(ctx.memberId)}`;
    const attempts =
      await tx`INSERT INTO rate_limits (bucket, window_start, count) VALUES (${bucket}, now(), 1) ON CONFLICT (bucket) DO UPDATE SET count = CASE WHEN rate_limits.window_start < now() - interval '1 hour' THEN 1 ELSE rate_limits.count + 1 END, window_start = CASE WHEN rate_limits.window_start < now() - interval '1 hour' THEN now() ELSE rate_limits.window_start END RETURNING count`;
    if (Number(attempts[0].count) > 5)
      throw new HiveError("Too many attempts. Please try later.", 429);
    const domain = emailDomain(String(actors[0].email));
    const workDomain = domain && !isPublicDomain(domain) ? domain : null;
    const name = (
      workDomain ? workDomain.split(".")[0] : `${actors[0].name}’s team`
    ).slice(0, 80);
    await tx`INSERT INTO teams (id, name, invite_code, invite_expires_at) VALUES (${teamId}, ${name}, ${hashToken(newToken())}, now() - interval '1 second')`;
    await tx`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${ctx.memberId}, ${teamId}, 'admin')`;
    await recordMembershipJoin(tx, ctx.memberId, teamId, "owner");
    await tx`SELECT hive_create_default_capture_rules(${teamId}, ${ctx.memberId})`;
    await followOwnerMemberships(tx, ctx.memberId);
    let eligible = false;
    if (workDomain) {
      const domains =
        await tx`INSERT INTO team_domains (team_id, domain, created_by) VALUES (${teamId}, ${workDomain}, ${ctx.memberId}) ON CONFLICT (domain) DO NOTHING RETURNING domain`;
      eligible = domains.length > 0;
    }
    let phrase: string | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = randomJoinPhrase();
      const rows =
        await tx`INSERT INTO hive_join_phrases (phrase, team_id, generation, created_by) VALUES (${candidate}, ${teamId}, 1, ${ctx.memberId}) ON CONFLICT (phrase) DO NOTHING RETURNING phrase`;
      if (rows[0]) {
        phrase = String(rows[0].phrase);
        break;
      }
    }
    if (!phrase)
      throw new HiveError(
        "A join link could not be created. Try again later.",
        503,
      );
    await tx`UPDATE teams SET join_generation = 1, join_paused = ${!eligible} WHERE id = ${teamId}`;
    const policy = await ownerCapturePolicy(ctx, tx);
    async function publishSelected(index: number): Promise<void> {
      if (index >= policy.include.length) return;
      await publishProject(ctx, teamId, policy.include[index], tx);
      await publishSelected(index + 1);
    }
    await publishSelected(0);
    return { teamId, teamName: name, paused: !eligible };
  });
}
