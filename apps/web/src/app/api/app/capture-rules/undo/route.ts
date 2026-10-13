import { authenticated } from "@/lib/http";
import { undoCaptureRuleInstruction } from "@/server/capture-rule-instructions";
import { rateLimit } from "@/server/identity/rate-limit";

export async function POST() {
  return authenticated(async (ctx) => {
    await rateLimit(
      "capture-rule-undo",
      `${ctx.teamId}/${ctx.memberId}`,
      10,
      60,
    );
    return Response.json(
      await undoCaptureRuleInstruction(ctx, { source: "web" }),
    );
  });
}
