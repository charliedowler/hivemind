import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { setCaptureRuleFromText, undoCaptureRuleInstruction } from "@/server/capture-rule-instructions";
import { requireAdmin } from "@/server/identity/access";
import { rateLimit } from "@/server/identity/rate-limit";

const input = z.object({
  scope: z.enum(["team", "personal"]).default("personal"),
  text: z
    .string()
    .trim()
    .min(1, "Describe what Hive should leave out.")
    .max(4000, "Keep the description to 4000 characters or fewer."),
});

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const { text, scope } = input.parse(await readJson(request));
    await rateLimit(
      "capture-rule-instruction",
      `${ctx.teamId}/${ctx.memberId}`,
      10,
      60,
    );
    if (scope === "team") await requireAdmin(ctx);
    const result = /^undo[.!]?$/i.test(text)
      ? await undoCaptureRuleInstruction(ctx, { source: "web" })
      : await setCaptureRuleFromText(ctx, `${scope === "team" ? "For the whole team" : "For my agents only"}: ${text}`, { source: "web" });
    return Response.json({ ...result, question: result.question?.replace(/\brules?\b/gi, "exclusion").replace(/\bscope\b/gi, "who it affects") });
  });
}
