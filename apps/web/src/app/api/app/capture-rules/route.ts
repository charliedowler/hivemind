import { captureRuleInputSchema } from "@hivemind/core";
import { authenticated, readJson } from "@/lib/http";
import { createCaptureRule, listCaptureRules } from "@/server/capture-rules";
import { requireAdmin } from "@/server/identity/access";

export async function GET() {
  return authenticated(async (ctx) => {
    const [rules, isAdmin] = await Promise.all([
      listCaptureRules(ctx),
      requireAdmin(ctx)
        .then(() => true)
        .catch(() => false),
    ]);
    return Response.json(
      { rules, isAdmin },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function POST(request: Request) {
  return authenticated(async (ctx) =>
    Response.json(
      await createCaptureRule(ctx, {
        ...captureRuleInputSchema.parse(await readJson(request)),
        source: "web",
      }),
      { status: 201 },
    ),
  );
}
