import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { requireAdmin } from "../identity/access";

export const reportNames = [
  "usage",
  "funnel",
  "knowledge",
  "quality",
  "stalls",
] as const;
export type ReportName = (typeof reportNames)[number];
export type ReportRow = Record<string, string | number | boolean | null>;
export async function analyticsReports(
  ctx: HiveContext,
): Promise<Record<ReportName, ReportRow[]>> {
  await requireAdmin(ctx);
  const queries = await Promise.all(
    reportNames.map((name) =>
      readFile(join(process.cwd(), "analytics", `${name}.sql`), "utf8"),
    ),
  );
  const rows = await getSql().begin(async (tx) => {
    await tx`SET TRANSACTION READ ONLY`;
    await tx`SELECT set_config('hive.reporting_team', ${ctx.teamId}, true), set_config('statement_timeout', '5000', true)`;
    return Promise.all(queries.map((query) => tx.unsafe<ReportRow[]>(query)));
  });
  return {
    usage: rows[0],
    funnel: rows[1],
    knowledge: rows[2],
    quality: rows[3],
    stalls: rows[4],
  };
}
