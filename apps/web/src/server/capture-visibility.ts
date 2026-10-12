import { sql } from "drizzle-orm";
import type { HiveContext, LearningView } from "@hivemind/core";
import { getSql } from "./db/client";
import { currentOrigin } from "./analytics/events";
import { learnings } from "./db/schema";

function publicOnly() {
  return ["slack", "scheduled"].includes(currentOrigin()?.entrypoint ?? "");
}

export function learningVisibleTo(ctx: HiveContext) {
  return sql`(${learnings}.capture_flagged = false OR (NOT ${publicOnly()} AND ${learnings.memberId} = ${ctx.memberId}))`;
}

export function learningVisibleSql(ctx: HiveContext, alias = "l") {
  const query = getSql();
  return query`(${query(`${alias}.capture_flagged`)} = false OR (NOT ${publicOnly()} AND ${query(`${alias}.member_id`)} = ${ctx.memberId}))`;
}

export function visibleSupersededBySql(ctx: HiveContext, alias = "l") {
  const query = getSql();
  return query`CASE WHEN EXISTS (SELECT 1 FROM learnings capture_successor WHERE capture_successor.id = ${query(`${alias}.superseded_by`)} AND capture_successor.team_id = ${query(`${alias}.team_id`)} AND ${learningVisibleSql(ctx, "capture_successor")}) THEN ${query(`${alias}.superseded_by`)} ELSE NULL END`;
}

export function learningVisible(
  ctx: HiveContext,
  cell: LearningView & { captureFlagged?: boolean },
) {
  return !cell.captureFlagged || (!publicOnly() && cell.author.id === ctx.memberId);
}
