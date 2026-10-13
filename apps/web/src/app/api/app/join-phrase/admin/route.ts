import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import {
  adminJoinPhrase,
  generateJoinPhrase,
  rotateJoinPhrase,
  pauseJoinPhrase,
} from "@/server/identity/join-phrases";
import { allowDomain } from "@/server/identity/access";
import { memberContext } from "@/server/identity/enrollment";
import { HiveError } from "@/server/errors";
import { getSql } from "@/server/db/client";
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    const data = z
      .strictObject({
        teamId: z.string().min(1),
        action: z.enum(["generate", "rotate", "pause", "resume", "domain"]),
      })
      .parse(await readJson(request));
    const team = await memberContext(ctx.memberId, data.teamId);
    if (!team) throw new HiveError("This hive is no longer available.", 403);
    if (data.action === "domain") await allowDomain(team);
    else if (data.action === "generate") await generateJoinPhrase(team);
    else if (data.action === "rotate") await rotateJoinPhrase(team);
    else await pauseJoinPhrase(team, data.action === "pause");
    const [phrase, domains] = await Promise.all([
      adminJoinPhrase(team),
      getSql()`SELECT domain FROM team_domains WHERE team_id = ${team.teamId} ORDER BY domain`,
    ]);
    return Response.json({
      phrase,
      domains: domains.map((row) => String(row.domain)),
    });
  });
}
