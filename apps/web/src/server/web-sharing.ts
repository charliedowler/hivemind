import type { HiveContext } from "@hivemind/core";
import { getSql } from "./db/client";
import { hiveChoices } from "./identity/onboarding-web";

export async function projectShareState(ctx: HiveContext) {
  const [hives, grants] = await Promise.all([
    hiveChoices(ctx),
    getSql()`SELECT g.id, g.team_id, g.repo_pattern FROM project_sharing_grants g JOIN hive_memberships h ON h.team_id = g.team_id AND h.member_id = ${ctx.memberId} AND h.removed_at IS NULL WHERE g.owner_member_id = ${ctx.memberId} AND g.withdrawn_at IS NULL ORDER BY g.team_id, g.repo_pattern`,
  ]);
  return hives
    .filter((hive) => !hive.personal)
    .map((hive) => ({
      ...hive,
      grants: grants
        .filter((grant) => grant.team_id === hive.teamId)
        .map((grant) => ({
          id: String(grant.id),
          pattern: String(grant.repo_pattern),
        })),
    }));
}

export async function cellShareState(ctx: HiveContext, id: string) {
  const cells =
    await getSql()`SELECT l.id FROM learnings l JOIN teams t ON t.id = l.team_id WHERE l.id = ${id} AND l.owner_member_id = ${ctx.memberId} AND t.personal_owner_member_id = ${ctx.memberId}`;
  if (!cells.length) return { owner: false, organisations: [] };
  const [hives, shares] = await Promise.all([
    hiveChoices(ctx),
    getSql()`SELECT team_id FROM learning_shares WHERE learning_id = ${id} AND owner_member_id = ${ctx.memberId} AND withdrawn_at IS NULL`,
  ]);
  const shared = new Set(shares.map((row) => String(row.team_id)));
  return {
    owner: true,
    organisations: hives
      .filter((hive) => !hive.personal)
      .map((hive) => ({
        teamId: hive.teamId,
        teamName: hive.teamName,
        shared: shared.has(hive.teamId),
      })),
  };
}
