import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { applyCaptureRule } from "@/server/capture-rules";

const input = z.object({
  token: z.string().min(1, "Preview the rule before applying it.").max(512),
  confirmed: z.literal(true, {
    error: "Confirm the preview before applying this rule.",
  }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return authenticated(async (ctx) => {
    const { token } = input.parse(await readJson(request));
    return Response.json(await applyCaptureRule(ctx, (await params).id, token));
  });
}
