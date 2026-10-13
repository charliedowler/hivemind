import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { proposeRuleFromText } from "@/server/capture-rules";
import { rateLimit } from "@/server/identity/rate-limit";

const input = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Describe what the rule should match.")
    .max(4000, "Keep the description to 4000 characters or fewer."),
});

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const { text } = input.parse(await readJson(request));
    await rateLimit(
      "capture-rule-proposal",
      `${ctx.teamId}/${ctx.memberId}`,
      10,
      60,
    );
    return Response.json(
      await proposeRuleFromText(ctx.teamId, ctx.memberId, text),
    );
  });
}
