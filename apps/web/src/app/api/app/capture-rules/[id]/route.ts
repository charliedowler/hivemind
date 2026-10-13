import { captureRuleInputSchema } from "@hivemind/core";
import { authenticated, readJson } from "@/lib/http";
import { deleteCaptureRule, updateCaptureRule } from "@/server/capture-rules";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return authenticated(async (ctx) =>
    Response.json(
      await updateCaptureRule(ctx, (await params).id, {
        ...captureRuleInputSchema.parse(await readJson(request)),
        source: "web",
      }),
    ),
  );
}

export async function DELETE(_request: Request, { params }: Params) {
  return authenticated(async (ctx) =>
    Response.json(await deleteCaptureRule(ctx, (await params).id)),
  );
}
