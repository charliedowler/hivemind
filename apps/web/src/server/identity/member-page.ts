import type { HiveContext } from "@hivemind/core";
import { listMembers, teamOverview } from "../hive";
import { getSql } from "../db/client";
export async function memberPage(ctx: HiveContext) {
  const [members, overview] = await Promise.all([
    listMembers(ctx),
    teamOverview(ctx),
  ]);
  const keys =
    overview.role === "admin"
      ? await getSql()`SELECT id, member_id, label, prefix, revoked_at FROM api_keys WHERE team_id = ${ctx.teamId} ORDER BY created_at DESC`
      : [];
  return {
    members,
    overview,
    keys: keys.map((key) => ({
      id: String(key.id),
      member_id: String(key.member_id),
      prefix: String(key.prefix),
      label: String(key.label),
      revoked_at: key.revoked_at?.toISOString() ?? null,
    })),
    memberId: ctx.memberId,
  };
}
