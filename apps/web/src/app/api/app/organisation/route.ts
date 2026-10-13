import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { humanActor } from "@/server/identity/onboarding-web";
import { memberContext } from "@/server/identity/enrollment";
import { requireAdmin } from "@/server/identity/access";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    await humanActor(ctx);
    const data = z
      .strictObject({
        teamId: z.string().min(1),
        name: z.string().trim().min(1).max(80),
      })
      .parse(await readJson(request));
    const team = await memberContext(ctx.memberId, data.teamId);
    if (!team) throw new HiveError("This hive is no longer available.", 403);
    await requireAdmin(team);
    const rows =
      await getSql()`UPDATE teams SET name = ${data.name} WHERE id = ${team.teamId} AND personal_owner_member_id IS NULL AND EXISTS (SELECT 1 FROM hive_memberships WHERE team_id = teams.id AND member_id = ${ctx.memberId} AND role = 'admin' AND removed_at IS NULL) RETURNING name`;
    if (!rows.length)
      throw new HiveError("This hive is no longer available.", 403);
    return Response.json({ name: String(rows[0].name) });
  });
}
