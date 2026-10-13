import { sql } from "drizzle-orm";
import type { HiveContext, LearningView } from "@hivemind/core";
import { getSql } from "./db/client";
import { currentOrigin } from "./analytics/events";
import { learnings } from "./db/schema";
import { hasPersonScope } from "./identity/credential-scope";

export function organisationOnly() {
  return ["slack", "scheduled"].includes(currentOrigin()?.entrypoint ?? "");
}
export function learningVisibleTo(ctx: HiveContext) {
  return sql`(${learnings}.capture_flagged = false OR (NOT ${organisationOnly()} AND ${learnings.memberId} = ${ctx.memberId}))`;
}
export function learningVisibleSql(ctx: HiveContext, alias = "l") {
  const q = getSql();
  return q`(${q(`${alias}.capture_flagged`)} = false OR (NOT ${organisationOnly()} AND (${q(`${alias}.member_id`)} = ${ctx.memberId} OR EXISTS (SELECT 1 FROM teams personal JOIN hive_memberships mine ON mine.team_id = personal.id WHERE personal.id = ${q(`${alias}.team_id`)} AND personal.personal_owner_member_id = ${q(`${alias}.owner_member_id`)} AND mine.member_id = ${ctx.memberId} AND mine.removed_at IS NULL))))`;
}
export function audienceCellsSql(ctx: HiveContext) {
  const q = getSql();
  return q`(SELECT DISTINCT ON (l.id) l.* FROM learning_audience_cells l WHERE ${learningVisibleSql(ctx)} AND EXISTS (SELECT 1 FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = l.team_id AND h.removed_at IS NULL AND m.disabled_at IS NULL) AND (l.team_id = ${ctx.teamId} OR (NOT ${organisationOnly()} AND ${hasPersonScope(ctx) || !["api_key", "oauth"].includes(currentOrigin()?.sessionKind ?? "")} AND EXISTS (SELECT 1 FROM teams personal JOIN hive_memberships selected ON selected.team_id = personal.id AND selected.member_id = ${ctx.memberId} AND selected.removed_at IS NULL WHERE personal.id = ${ctx.teamId} AND personal.personal_owner_member_id IS NOT NULL))) AND (NOT ${organisationOnly()} OR EXISTS (SELECT 1 FROM teams org WHERE org.id = l.team_id AND org.personal_owner_member_id IS NULL)) ORDER BY l.id, (l.team_id = ${ctx.teamId}) DESC, l.team_id)`;
}
export function visibleSupersededBySql(ctx: HiveContext, alias = "l") {
  const q = getSql();
  return q`CASE WHEN EXISTS (SELECT 1 FROM ${audienceCellsSql(ctx)} capture_successor WHERE capture_successor.id = ${q(`${alias}.superseded_by`)} AND ${learningVisibleSql(ctx, "capture_successor")}) THEN ${q(`${alias}.superseded_by`)} ELSE NULL END`;
}
export function learningVisible(ctx: HiveContext, cell: LearningView & {captureFlagged?: boolean}) {
  return !cell.captureFlagged || (!organisationOnly() && (cell.author.id === ctx.memberId || cell.canConfirmCapture));
}
