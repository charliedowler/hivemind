import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { previewCaptureRule } from "@/server/capture-rules";

const input = z.object({
  cursor: z
    .string()
    .regex(/^lrn_[a-z2-7]{12}$/, "Check the preview cursor.")
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return authenticated(async (ctx) => {
    const { cursor } = input.parse(await readJson(request));
    return Response.json(
      await previewCaptureRule(ctx, (await params).id, cursor),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  });
}
