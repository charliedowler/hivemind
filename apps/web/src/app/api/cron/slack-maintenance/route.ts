import { getSql } from "@/server/db/client";
import { syncChannels } from "@/server/slack/install";
import { retryPendingSlack } from "@/server/slack/queue";
import { authorizedCron } from "../slack-digests/route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizedCron(request))
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  const started = Date.now();
  const teams =
    await getSql()`SELECT i.team_id,t.name AS team_name,m.id AS member_id,m.name AS member_name
    FROM slack_installations i JOIN teams t ON t.id=i.team_id
    JOIN LATERAL (SELECT person.id,person.name FROM hive_memberships h JOIN members person ON person.id=h.member_id WHERE h.team_id=i.team_id AND h.role='admin' AND person.actor_type='human' AND h.removed_at IS NULL AND person.disabled_at IS NULL AND NOT person.provisional ORDER BY person.id LIMIT 1) m ON true
    WHERE i.active ORDER BY i.team_id`;
  const results = [];
  for (const team of teams) {
    if (Date.now() - started > 230_000) break;
    const ctx = {
      teamId: String(team.team_id),
      teamName: String(team.team_name),
      memberId: String(team.member_id),
      memberName: String(team.member_name),
    };
    const [channels, pending] = await Promise.allSettled([
      syncChannels(ctx),
      retryPendingSlack(ctx),
    ]);
    results.push({
      teamId: ctx.teamId,
      channels: channels.status,
      pending: pending.status,
      retried: pending.status === "fulfilled" ? pending.value : 0,
    });
  }
  return Response.json({ results, remaining: teams.length - results.length });
}
