import { z } from "zod";
import { readJson, authenticated } from "@/lib/http";
import { undoCaptureRuleInstruction } from "@/server/capture-rule-instructions";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { rateLimit } from "@/server/identity/rate-limit";

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    await rateLimit(
      "capture-rule-undo",
      `${ctx.teamId}/${ctx.memberId}`,
      10,
      60,
    );
    const { ruleId } = z.object({ ruleId: z.string().min(1).max(200) }).parse(await readJson(request));
    const [latest] = await getSql()`SELECT id, rule_id FROM capture_rule_instructions WHERE team_id = ${ctx.teamId} AND member_id = ${ctx.memberId} AND source = 'web' AND outcome = 'saved' ORDER BY created_at DESC, id DESC LIMIT 1`;
    if (latest?.rule_id !== ruleId) throw new HiveError("A newer change exists. Reload before undoing it.", 409);
    return Response.json(
      await undoCaptureRuleInstruction(ctx, { source: "web" }, latest.id),
    );
  });
}
